
const pool = require("../config/db");

const createJob = async (req, res) => {
    let connection;

    try {
        const { type, priority } = req.body;

        if (
            typeof type !== "string" ||
            !type.trim() ||
            !Number.isInteger(priority) ||
            priority < 1 ||
            priority > 10
        ) {
            return res.status(400).json({
                message: "Provide a valid type and priority (1-10)"
            });
        }

        const userId = req.user.id;

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [result] = await connection.execute(
            `INSERT INTO jobs (user_id, type, priority, status)
             VALUES (?, ?, ?, ?)`,
            [userId, type.trim(), priority, "QUEUED"]
        );

        const jobId = result.insertId;

        await connection.execute(
            `INSERT INTO job_outbox (job_id, event_type)
             VALUES (?, ?)`,
            [jobId, "JOB_CREATED"]
        );

        await connection.commit();

        return res.status(201).json({
            job_id: jobId,
            user_id: userId,
            type: type.trim(),
            priority,
            status: "QUEUED"
        });
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Rollback failed:", rollbackError.message);
            }
        }

        console.error("Error creating job:", error);

        return res.status(500).json({
            message: "Failed to create job"
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

const getJobs = async (req, res) => {
    try {
        const userId = req.user.id;

        const [rows] = await pool.execute(
            `SELECT id, user_id, type, priority, status, created_at
             FROM jobs
             WHERE user_id = ?
             ORDER BY created_at DESC`,
            [userId]
        );

        return res.status(200).json(rows);
    } catch (error) {
        console.error("Error fetching jobs:", error);

        return res.status(500).json({
            message: "Failed to fetch jobs"
        });
    }
};

const getJobById = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const userId = req.user.id;

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                message: "Invalid job ID"
            });
        }

        const [rows] = await pool.execute(
            `SELECT id, user_id, type, priority, status, created_at
             FROM jobs
             WHERE id = ? AND user_id = ?`,
            [id, userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                message: "Job not found"
            });
        }

        return res.status(200).json(rows[0]);
    } catch (error) {
        console.error("Error fetching job:", error);

        return res.status(500).json({
            message: "Failed to fetch job"
        });
    }
};

module.exports = {
    createJob,
    getJobs,
    getJobById
};
