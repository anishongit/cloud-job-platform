const pool = require("../config/db");

// ======================================================
// CREATE JOB
// ======================================================

const createJob = async (req, res) => {

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

        const [result] = await pool.execute(
            `INSERT INTO jobs
             (user_id, type, priority, status)
             VALUES (?, ?, ?, ?)`,
            [
                userId,
                type.trim(),
                priority,
                "QUEUED"
            ]
        );

        return res.status(201).json({
            job_id: result.insertId,
            user_id: userId,
            type: type.trim(),
            priority,
            status: "QUEUED"
        });

    } catch (error) {

        console.error("Error creating job:", error);

        return res.status(500).json({
            message: "Failed to create job"
        });
    }
};


// ======================================================
// GET ALL JOBS FOR CURRENT USER
// ======================================================

const getJobs = async (req, res) => {

    try {

        const userId = req.user.id;

        const [rows] = await pool.execute(
            `SELECT
                id,
                user_id,
                type,
                priority,
                status,
                created_at
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


// ======================================================
// GET SINGLE JOB FOR CURRENT USER
// ======================================================

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
            `SELECT
                id,
                user_id,
                type,
                priority,
                status,
                created_at
             FROM jobs
             WHERE id = ?
             AND user_id = ?`,
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