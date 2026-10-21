
const pool = require("../src/config/db");
const {
    redisClient,
    connectRedis
} = require("../src/config/redis");

const POLL_INTERVAL = 2000;
const QUEUE_NAME = "job_queue";
const PROCESSING_QUEUE = "job_processing";

const MAX_ATTEMPTS = 3;
const STUCK_JOB_TIMEOUT_SECONDS = 60;

// Wait between polling attempts
const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

// Atomically move the highest-priority job from the queue
// into a processing set, recording when it was claimed.
const dequeueJob = async () => {
    const result = await redisClient.eval(
        `local job = redis.call('ZPOPMAX', KEYS[1], 1)
         if #job == 0 then
             return nil
         end
         redis.call('ZADD', KEYS[2], ARGV[1], job[1])
         return job[1]`,
        {
            keys: [QUEUE_NAME, PROCESSING_QUEUE],
            arguments: [String(Date.now())]
        }
    );

    return result ? String(result) : null;
};

// Claim the job in MySQL so only one worker can process it.
const claimJobInDatabase = async (jobId) => {
    const connection = await pool.getConnection();

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

        await connection.execute(
            `UPDATE jobs
             SET status = 'PROCESSING',
                 attempts = attempts + 1,
                 started_at = CURRENT_TIMESTAMP
             WHERE id = ? AND status = 'QUEUED'`,
            [jobId]
        );

        await connection.commit();

        return {
            ...job,
            status: "PROCESSING",
            attempts: job.attempts + 1
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

// Replace this simulation with actual job logic later.
const processJob = async (job) => {
    console.log("--------------------------------");
    console.log(`Processing Job ${job.id}`);
    console.log(`Type: ${job.type}`);
    console.log(`Priority: ${job.priority}`);
    console.log("--------------------------------");

    await sleep(5000);
if (job.type === "test-failure") {
    throw new Error("Simulated processing failure");
}
    console.log(`Job ${job.id} processing finished`);
};

// Update the database and acknowledge the Redis processing entry.
const finishJob = async (jobId, status) => {
    await pool.execute(
        `UPDATE jobs
         SET status = ?,
             completed_at = CASE
                 WHEN ? = 'COMPLETED' THEN CURRENT_TIMESTAMP
                 ELSE NULL
             END
         WHERE id = ? AND status = 'PROCESSING'`,
        [status, status, jobId]
    );

    await redisClient.zRem(PROCESSING_QUEUE, String(jobId));
};
const recoverStuckJobs = async () => {
    const [stuckJobs] = await pool.execute(
        `SELECT id, attempts, priority
         FROM jobs
         WHERE status = 'PROCESSING'
           AND started_at < DATE_SUB(
               CURRENT_TIMESTAMP,
               INTERVAL ? SECOND
           )`,
        [STUCK_JOB_TIMEOUT_SECONDS]
    );

    for (const job of stuckJobs) {
        if (job.attempts >= MAX_ATTEMPTS) {
            await pool.execute(
                `UPDATE jobs
                 SET status = 'FAILED'
                 WHERE id = ? AND status = 'PROCESSING'`,
                [job.id]
            );

            await redisClient.zRem(
                PROCESSING_QUEUE,
                String(job.id)
            );

            console.log(
                `Job ${job.id} marked FAILED after ${job.attempts} attempts`
            );

            continue;
        }

        const [result] = await pool.execute(
            `UPDATE jobs
             SET status = 'QUEUED', started_at = NULL
             WHERE id = ? AND status = 'PROCESSING'`,
            [job.id]
        );

        if (result.affectedRows === 1) {
            await redisClient.zRem(
                PROCESSING_QUEUE,
                String(job.id)
            );

            await redisClient.zAdd(QUEUE_NAME, [
                {
                    score: Number(job.priority),
                    value: String(job.id),
                },
            ]);

            console.log(
                `Recovered job ${job.id}; retry ${job.attempts + 1}`
            );
        }
    }
};
const startWorker = async () => {
    await connectRedis();

    console.log("Redis worker started.");
    console.log("Waiting for jobs...");

    while (true) {
        let jobId = null;

        try {
            await recoverStuckJobs();
            jobId = await dequeueJob();

            if (!jobId) {
                await sleep(POLL_INTERVAL);
                continue;
            }

            const job = await claimJobInDatabase(jobId);

            // Ignore stale or duplicate queue entries.
            if (!job) {
                await redisClient.zRem(
                    PROCESSING_QUEUE,
                    String(jobId)
                );
                continue;
            }

            try {
    await processJob(job);

    await finishJob(job.id, "COMPLETED");
    console.log(`Job ${job.id} marked COMPLETED`);

} catch (error) {
    console.error(`Job ${job.id} failed:`, error.message);

    if (job.attempts < MAX_ATTEMPTS) {
        const [result] = await pool.execute(
            `UPDATE jobs
             SET status = 'QUEUED',
                 started_at = NULL
             WHERE id = ? AND status = 'PROCESSING'`,
            [job.id]
        );

        if (result.affectedRows === 1) {
            await redisClient.zRem(PROCESSING_QUEUE, String(job.id));

            await redisClient.zAdd(QUEUE_NAME, [
                {
                    score: Number(job.priority),
                    value: String(job.id)
                }
            ]);

            console.log(
                `Job ${job.id} requeued for attempt ${job.attempts + 1}`
            );
        }

    } else {
        await finishJob(job.id, "FAILED");

        console.log(
            `Job ${job.id} marked FAILED after ${job.attempts} attempts`
        );
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
