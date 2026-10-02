const pool = require("../src/config/db");

const POLL_INTERVAL = 3000;


// ======================================================
// PROCESS JOB
// ======================================================

const processJob = async (job) => {

    console.log("--------------------------------");
    console.log(`Processing Job ${job.id}`);
    console.log(`Type: ${job.type}`);
    console.log(`Priority: ${job.priority}`);
    console.log("--------------------------------");

    // Simulate a 5-second job
    await new Promise(resolve =>
        setTimeout(resolve, 5000)
    );

    console.log(`Job ${job.id} completed`);
};


// ======================================================
// CLAIM NEXT JOB
// ======================================================

const claimNextJob = async () => {

    const connection = await pool.getConnection();

    try {

        await connection.beginTransaction();

        const [rows] = await connection.execute(
            `SELECT
                id,
                user_id,
                type,
                priority,
                status,
                created_at
             FROM jobs
             WHERE status = 'QUEUED'
             ORDER BY priority DESC, created_at ASC
             LIMIT 1
             FOR UPDATE`
        );

        if (rows.length === 0) {

            await connection.rollback();

            connection.release();

            return null;
        }

        const job = rows[0];

        await connection.execute(
            `UPDATE jobs
             SET status = 'PROCESSING'
             WHERE id = ?`,
            [job.id]
        );

        await connection.commit();

        connection.release();

        return job;

    } catch (error) {

        await connection.rollback();

        connection.release();

        throw error;
    }
};


// ======================================================
// WORKER LOOP
// ======================================================

const startWorker = async () => {

    console.log("Worker started...");
    console.log("Waiting for jobs...");

    while (true) {

        try {

            const job = await claimNextJob();

            if (!job) {

                await new Promise(resolve =>
                    setTimeout(resolve, POLL_INTERVAL)
                );

                continue;
            }

            try {

                await processJob(job);

                await pool.execute(
                    `UPDATE jobs
                     SET status = 'COMPLETED'
                     WHERE id = ?`,
                    [job.id]
                );

                console.log(
                    `Job ${job.id} marked as COMPLETED`
                );

            } catch (error) {

                console.error(
                    `Job ${job.id} failed:`,
                    error
                );

                await pool.execute(
                    `UPDATE jobs
                     SET status = 'FAILED'
                     WHERE id = ?`,
                    [job.id]
                );
            }

        } catch (error) {

            console.error(
                "Worker error:",
                error
            );

            await new Promise(resolve =>
                setTimeout(resolve, POLL_INTERVAL)
            );
        }
    }
};


startWorker();