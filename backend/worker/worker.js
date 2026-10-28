
const { randomUUID } = require("crypto");
const pool = require("../src/config/db");
const {
    redisClient,
    connectRedis
} = require("../src/config/redis");

const POLL_INTERVAL = 2000;
const QUEUE_NAME = "job_queue";
const PROCESSING_QUEUE = "job_processing";

const MAX_ATTEMPTS = 3;
const LEASE_DURATION_SECONDS = 30;
const LEASE_RENEW_INTERVAL_MS = 10000;

const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

// Move the highest-priority job into the processing set.

const dequeueJob = async () => {
    const result = await redisClient.zPopMax(QUEUE_NAME);

    if (!result) {
        return null;
    }

    return result.value;
};

// Claim a queued job in MySQL and assign a unique token.
const claimJobInDatabase = async (jobId) => {
    const connection = await pool.getConnection();
    const claimToken = randomUUID();

    try {
        await connection.beginTransaction();

        const [rows] = await connection.execute(
            `SELECT id, user_id, type, priority, status, attempts
             FROM jobs
             WHERE id = ?
             FOR UPDATE`,
            [jobId]
        );

        if (rows.length === 0 || rows[0].status !== "QUEUED") {
            await connection.rollback();
            return null;
        }

        const job = rows[0];

        const [result] = await connection.execute(
            `UPDATE jobs
             SET status = 'PROCESSING',
                 attempts = attempts + 1,
                 started_at = CURRENT_TIMESTAMP,
                 lease_expires_at = DATE_ADD(
                     CURRENT_TIMESTAMP,
                     INTERVAL ${LEASE_DURATION_SECONDS} SECOND
                 ),
                 claim_token = ?
             WHERE id = ?
               AND status = 'QUEUED'`,
            [claimToken, jobId]
        );

        if (result.affectedRows !== 1) {
            await connection.rollback();
            return null;
        }

        await connection.commit();

        return {
            ...job,
            status: "PROCESSING",
            attempts: job.attempts + 1,
            claim_token: claimToken
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

// Renew a lease only if this worker still owns the claim.
const renewJobLease = async (jobId, claimToken) => {
    const [result] = await pool.execute(
        `UPDATE jobs
         SET lease_expires_at = DATE_ADD(
             CURRENT_TIMESTAMP,
             INTERVAL ${LEASE_DURATION_SECONDS} SECOND
         )
         WHERE id = ?
           AND status = 'PROCESSING'
           AND claim_token = ?
           AND lease_expires_at > CURRENT_TIMESTAMP`,
        [jobId, claimToken]
    );

    return result.affectedRows === 1;
};

// Renew the lease sequentially while the job is processing.
const startLeaseHeartbeat = (jobId, claimToken) => {
    let stopped = false;
    let renewalFailed = false;

    const run = async () => {
        while (!stopped) {
            await sleep(LEASE_RENEW_INTERVAL_MS);

            if (stopped) break;

            try {
                const renewed = await renewJobLease(
                    jobId,
                    claimToken
                );

                if (!renewed) {
                    renewalFailed = true;
                    console.error(
                        `Lease renewal rejected for job ${jobId}`
                    );
                    break;
                }
            } catch (error) {
                renewalFailed = true;
                console.error(
                    `Lease renewal error for job ${jobId}:`,
                    error.message
                );
                break;
            }
        }
    };

    const promise = run();

    return {
        stop: () => {
            stopped = true;
        },
        promise,
        hasFailed: () => renewalFailed
    };
};

// Simulated job execution.
const processJob = async (job) => {
    const heartbeat = startLeaseHeartbeat(
        job.id,
        job.claim_token
    );

    try {
        console.log("--------------------------------");
        console.log(`Processing Job ${job.id}`);
        console.log(`Type: ${job.type}`);
        console.log(`Priority: ${job.priority}`);
        console.log(`Attempt: ${job.attempts}`);
        console.log("--------------------------------");

        await sleep(5000);

        if (job.type === "test-failure") {
            throw new Error("Simulated processing failure");
        }

        if (heartbeat.hasFailed()) {
            throw new Error("Job lease could not be renewed");
        }

        console.log(`Job ${job.id} processing finished`);
    } finally {
        heartbeat.stop();
        await heartbeat.promise;
    }
};

// Complete or fail a job only if the claim token is still valid.

const finishJob = async (jobId, status, claimToken) => {
    const [result] = await pool.execute(
        `UPDATE jobs
         SET status = ?,
             completed_at = CASE
                 WHEN ? = 'COMPLETED'
                 THEN CURRENT_TIMESTAMP
                 ELSE NULL
             END,
             lease_expires_at = NULL,
             claim_token = NULL
         WHERE id = ?
           AND status = 'PROCESSING'
           AND claim_token = ?
           AND lease_expires_at > CURRENT_TIMESTAMP`,
        [status, status, jobId, claimToken]
    );

    if (result.affectedRows !== 1) {
        console.error(
            `Job ${jobId}: status update rejected; claim is no longer valid`
        );
        return false;
    }

    await redisClient.zRem(
        PROCESSING_QUEUE,
        String(jobId)
    );

    return true;
};

// Recover jobs with expired processing leases.

const recoverStuckJobs = async () => {
    const [stuckJobs] = await pool.execute(
        `SELECT id, attempts, priority
         FROM jobs
         WHERE status = 'PROCESSING'
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at < CURRENT_TIMESTAMP`
    );

    for (const job of stuckJobs) {
        const nextStatus =
            job.attempts >= MAX_ATTEMPTS ? "FAILED" : "QUEUED";

        const [result] = await pool.execute(
            `UPDATE jobs
             SET status = ?,
                 started_at = NULL,
                 lease_expires_at = NULL,
                 claim_token = NULL
             WHERE id = ?
               AND status = 'PROCESSING'
               AND lease_expires_at < CURRENT_TIMESTAMP`,
            [nextStatus, job.id]
        );

        if (result.affectedRows !== 1) {
            continue;
        }

        // Remove the old processing entry.
        await redisClient.zRem(
            PROCESSING_QUEUE,
            String(job.id)
        );

        if (nextStatus === "QUEUED") {
            await redisClient.zAdd(QUEUE_NAME, [{
                score: Number(job.priority),
                value: String(job.id)
            }]);

            console.log(
                `Recovered job ${job.id}; next attempt ${job.attempts + 1}`
            );
        } else {
            console.log(
                `Job ${job.id} marked FAILED after ${job.attempts} attempts`
            );
        }
    }
};

const reconcileQueuedJobs = async () => {
    const [queuedJobs] = await pool.execute(
        `SELECT id, priority
         FROM jobs
         WHERE status = 'QUEUED'`
    );

    for (const job of queuedJobs) {
        const jobId = String(job.id);

        const [queueScore, processingScore] = await Promise.all([
            redisClient.zScore(QUEUE_NAME, jobId),
            redisClient.zScore(PROCESSING_QUEUE, jobId)
        ]);

        // Don't enqueue a job already present in either set.
        if (queueScore !== null || processingScore !== null) {
            continue;
        }

        await redisClient.zAdd(QUEUE_NAME, [{
            score: Number(job.priority),
            value: jobId
        }]);

        console.log(`Reconciled queued job ${jobId}`);
    }
};
// Main worker loop.
const startWorker = async () => {
    await connectRedis();

    console.log("Redis worker started.");
    console.log("Waiting for jobs...");

    while (true) {
        try {
            await recoverStuckJobs();
            await reconcileQueuedJobs();

            const jobId = await dequeueJob();

            if (!jobId) {
                await sleep(POLL_INTERVAL);
                continue;
            }

            const job = await claimJobInDatabase(jobId);

            // Ignore stale or duplicate queue entries.
            if (!job) {
                continue;
            }

            await redisClient.zAdd(PROCESSING_QUEUE, [{
    score: Date.now(),
    value: String(job.id)
}]);

            try {
                await processJob(job);

                const completed = await finishJob(
                    job.id,
                    "COMPLETED",
                    job.claim_token
                );

                if (completed) {
                    console.log(`Job ${job.id} marked COMPLETED`);
                }
            } catch (error) {
                console.error(
                    `Job ${job.id} failed:`,
                    error.message
                );

                if (job.attempts < MAX_ATTEMPTS) {
                    const [result] = await pool.execute(
                        `UPDATE jobs
                         SET status = 'QUEUED',
                             started_at = NULL,
                             lease_expires_at = NULL,
                             claim_token = NULL
                         WHERE id = ?
                           AND status = 'PROCESSING'
                           AND claim_token = ?
                           AND lease_expires_at > CURRENT_TIMESTAMP`,
                        [job.id, job.claim_token]
                    );

                    if (result.affectedRows === 1) {
                        await redisClient.zRem(
                            PROCESSING_QUEUE,
                            String(job.id)
                        );

                        await redisClient.zAdd(QUEUE_NAME, [
                            {
                                score: Number(job.priority),
                                value: String(job.id)
                            }
                        ]);

                        console.log(
                            `Job ${job.id} requeued for attempt ${job.attempts + 1}`
                        );
                    } else {
                        console.log(
                            `Job ${job.id}: retry skipped because its claim is no longer valid`
                        );
                    }
                } else {
                    const failed = await finishJob(
                        job.id,
                        "FAILED",
                        job.claim_token
                    );

                    if (failed) {
                        console.log(
                            `Job ${job.id} marked FAILED after ${job.attempts} attempts`
                        );
                    }
                }
            }
        } catch (error) {
            console.error("Worker error:", error.message);
            await sleep(POLL_INTERVAL);
        }
    }
};

startWorker().catch((error) => {
    console.error("Worker failed to start:", error);
    process.exitCode = 1;
});
