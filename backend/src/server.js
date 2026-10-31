
const pool = require("./config/db");
const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const logger = require("./logger");
const validateEnv = require("./config/validateEnv");
const authRoutes = require("./routes/authRoutes");
const jobRoutes = require("./routes/jobRoutes");
const pinoHttp = require("pino-http");

dotenv.config();
validateEnv();

const app = express();

// Middleware
app.use(pinoHttp({ logger }));
app.use(cors());
app.use(helmet());
app.use(express.json());

// Authentication rate limiter
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: {
        message: "Too many attempts, please try again later."
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Health check endpoint
app.get("/api/health", async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT 1 AS result");

        res.status(200).json({
            message: "Cloud Job Platform API is running",
            database: "Connected",
            test: rows[0].result
        });

    } catch (error) {
        logger.error(error, "Database connection failed");

        res.status(500).json({
            message: "Database connection failed",
            error: error.message
        });
    }
});

// Authentication endpoints
app.use("/api/auth", authLimiter, authRoutes);

// Job endpoints
app.use("/api/jobs", jobRoutes);

// Start server only when executed directly
if (require.main === module) {
    const PORT = process.env.PORT || 8000;

    app.listen(PORT, () => {
        logger.info(`Server running on port ${PORT}`);
    });
}

module.exports = app;
