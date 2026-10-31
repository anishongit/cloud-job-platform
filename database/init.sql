/*
  Database initialization script for Cloud Job Platform
  Creates tables: users, jobs, job_outbox
*/

CREATE DATABASE IF NOT EXISTS cloud_job_platform;
USE cloud_job_platform;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    type VARCHAR(100) NOT NULL,
    priority TINYINT UNSIGNED NOT NULL CHECK (priority BETWEEN 1 AND 10),
    status ENUM('QUEUED','PROCESSING','COMPLETED','FAILED') NOT NULL DEFAULT 'QUEUED',
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    lease_expires_at TIMESTAMP NULL DEFAULT NULL,
    claim_token VARCHAR(36) NULL,
    started_at TIMESTAMP NULL DEFAULT NULL,
    completed_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Index for fast status lookup
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_user ON jobs(user_id);

-- Outbox table for job events
CREATE TABLE IF NOT EXISTS job_outbox (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    published_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    INDEX idx_outbox_job (job_id),
    INDEX idx_outbox_published (published_at)
) ENGINE=InnoDB;

/*
  Add a sample user (password: password123) – replace with real credentials after init.
*/
INSERT INTO users (name, email, password_hash)
VALUES ('Demo User', 'demo@example.com', '$2a$10$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')
ON DUPLICATE KEY UPDATE email=email;
