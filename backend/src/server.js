const pool = require("./config/db");
const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const logger = require("./logger");
const validateEnv = require("./config/validateEnv");
const authRoutes = require("./routes/authRoutes");
dotenv.config();

const app = express();

// Middleware
const pinoHttp = require('pino-http');
app.use(pinoHttp({ logger }));
app.use(cors());
app.use(helmet()); // security headers
app.use(express.json());

// Simple in‑memory rate limiter for auth routes
const authRateMap = new Map();
function authLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 min
  const max = 20;
  let record = authRateMap.get(ip) || { count: 0, start: now };
  if (now - record.start > windowMs) {
    record = { count: 1, start: now };
  } else {
    record.count++;
  }
  authRateMap.set(ip, record);
  if (record.count > max) {
    return res.status(429).json({ message: "Too many attempts, please try again later." });
  }
  next();
}

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


// Authentication routes (must be registered before server starts listening)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per window
  message: { message: "Too many attempts, please try again later." }
});
app.use("/api/auth", authLimiter, authRoutes);

