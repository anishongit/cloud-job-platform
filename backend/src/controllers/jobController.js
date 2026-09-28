const pool = require("../config/db");

// ======================================================
// CREATE JOB
// ======================================================

const createJob = async (req, res) => {

    try {

        const { type, priority } = req.body;

        // Validate input
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

        // Insert job into database
        const [result] = await pool.execute(
            `INSERT INTO jobs (type, priority, status)
             VALUES (?, ?, ?)`,
            [type.trim(), priority, "QUEUED"]
        );

        // Send response
        return res.status(201).json({
            job_id: result.insertId,
            type: type.trim(),
            priority: priority,
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
// GET ALL JOBS
// ======================================================

const getJobs = async (req, res) => {

    try {

        const [rows] = await pool.execute(
            `SELECT
                id,
                type,
                priority,
                status,
                created_at
             FROM jobs
             ORDER BY created_at DESC`
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
// GET JOB BY ID
// ======================================================

const getJobById = async (req, res) => {

    try {

        const id = Number(req.params.id);

        // Validate ID
        if (!Number.isInteger(id) || id <= 0) {

            return res.status(400).json({
                message: "Invalid job ID"
            });
        }

        // Find job
        const [rows] = await pool.execute(
            `SELECT
                id,
                type,
                priority,
                status,
                created_at
             FROM jobs
             WHERE id = ?`,
            [id]
        );

        // Job doesn't exist
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


// ======================================================
// EXPORT FUNCTIONS
// ======================================================

module.exports = {
    createJob,
    getJobs,
    getJobById
};