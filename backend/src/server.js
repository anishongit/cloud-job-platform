const pool = require("./config/db");
const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Import job routes
const jobRoutes = require("./routes/jobRoutes");

// Health check endpoint
app.get("/api/health", async (req, res) => {

    try {

        const [rows] = await pool.query(
            "SELECT 1 AS result"
        );

        res.status(200).json({
            message: "Cloud Job Platform API is running",
            database: "Connected",
            test: rows[0].result
        });

    } catch (error) {

        console.error("Database connection failed:");
        console.error(error);

        res.status(500).json({
            message: "Database connection failed",
            error: error.message
        });
    }
});

// Job endpoints
app.use("/api/jobs", jobRoutes);

// Start server
const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});


app.use("/api/auth", authRoutes);