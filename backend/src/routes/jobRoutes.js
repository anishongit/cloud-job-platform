const express = require("express");

const {
    createJob,
    getJobs,
    getJobById
} = require("../controllers/jobController");

const authenticateToken = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/", authenticateToken, createJob);

router.get("/", authenticateToken, getJobs);

router.get("/:id", authenticateToken, getJobById);

module.exports = router;