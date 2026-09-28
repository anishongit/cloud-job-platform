
const express = require("express");

const {
    createJob,
    getJobs,
    getJobById
} = require("../controllers/jobController");

const router = express.Router();

router.post("/", createJob);
router.get("/", getJobs);
router.get("/:id", getJobById);

module.exports = router;