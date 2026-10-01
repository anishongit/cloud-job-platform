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

    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log(`Job ${job.id} completed`);

};


// ======================================================
// GET NEXT JOB
// ======================================================

const getNextJob = async () => {

    const [rows] = await pool.execute(
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
         LIMIT 1`
    );

    if (rows.length === 0) {
        return null;
    }

    return rows[0];
};


// ======================================================
// WORKER LOOP
// ======================================================

const startWorker = async () => {

    console.log("Worker started...");
    console.log("Waiting for jobs...");

    while (true) {

        try {

            const job = await getNextJob();

            if (!job) {

                await new Promise(resolve =>
                    setTimeout(resolve, POLL_INTERVAL)
                );

                continue;
            }

            // Mark job as processing
            await pool.execute(
                `UPDATE jobs
                 SET status = 'PROCESSING'
                 WHERE id = ?`,
                [job.id]
            );

            try {

                await processJob(job);

                // Mark completed
                await pool.execute(
                    `UPDATE jobs
                     SET status = 'COMPLETED'
                     WHERE id = ?`,
                    [job.id]
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