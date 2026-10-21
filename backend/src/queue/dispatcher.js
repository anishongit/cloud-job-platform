
const pool = require("../config/db");
const { redisClient, connectRedis } = require("../config/redis");

const POLL_INTERVAL = 2000;
const BATCH_SIZE = 50;
const QUEUE_NAME = "job_queue";

// Wait between dispatcher iterations
const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

// Publish pending outbox events to Redis
const publishPendingEvents = async () => {
    const [events] = await pool.execute(
        `SELECT
            o.id AS outbox_id,
            o.job_id,
            j.priority
         FROM job_outbox o
         JOIN jobs j ON j.id = o.job_id
         WHERE o.published_at IS NULL
           AND j.status = 'QUEUED'
         ORDER BY o.id ASC
         LIMIT ${BATCH_SIZE}`
    );

    for (const event of events) {
        // Use the job ID as the unique Redis queue member.
        // ZADD makes repeated publication of the same ID idempotent.
        await redisClient.zAdd(QUEUE_NAME, [
            {
                score: Number(event.priority),
                value: String(event.job_id),
            },
        ]);

        // Mark the event published only after Redis accepts it.
        await pool.execute(
            `UPDATE job_outbox
             SET published_at = CURRENT_TIMESTAMP
             WHERE id = ?
               AND published_at IS NULL`,
            [event.outbox_id]
        );

        console.log(
            `Published job ${event.job_id} to Redis (priority ${event.priority})`
        );
    }

    return events.length;
};

// Keep checking for pending events
const startDispatcher = async () => {
    console.log("Outbox dispatcher starting...");

    await connectRedis();

    console.log("Dispatcher connected to Redis.");
    console.log("Checking for pending outbox events...");

    while (true) {
        try {
            const count = await publishPendingEvents();

            if (count === 0) {
                await sleep(POLL_INTERVAL);
            }
        } catch (error) {
            console.error("Dispatcher error:", error.message);
            await sleep(POLL_INTERVAL);
        }
    }
};

startDispatcher().catch((error) => {
    console.error("Dispatcher failed to start:", error);
    process.exitCode = 1;
});
