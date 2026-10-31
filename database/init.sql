/*
  Database initialization script for Cloud Job Platform
  Compatible with legacy MySQL (5.0, 5.1, 5.5, 5.6) & modern MySQL/MariaDB
*/

CREATE DATABASE IF NOT EXISTS cloud_job_platform;
USE cloud_job_platform;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT NULL
) ENGINE=InnoDB;

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    type VARCHAR(100) NOT NULL,
    priority TINYINT UNSIGNED NOT NULL,
    status ENUM('QUEUED','PROCESSING','COMPLETED','FAILED') NOT NULL DEFAULT 'QUEUED',
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    lease_expires_at DATETIME NULL DEFAULT NULL,
    claim_token VARCHAR(36) NULL,
    started_at DATETIME NULL DEFAULT NULL,
    completed_at DATETIME NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT NULL,
    INDEX idx_jobs_status (status),
    INDEX idx_jobs_user (user_id),
    CONSTRAINT fk_jobs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Outbox table for job events
CREATE TABLE IF NOT EXISTS job_outbox (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    published_at DATETIME NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_outbox_job (job_id),
    INDEX idx_outbox_published (published_at),
    CONSTRAINT fk_outbox_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

/*
  Add a sample user (password: password123)
*/
INSERT INTO users (name, email, password_hash)
VALUES ('Demo User', 'demo@example.com', '$2a$10$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')
ON DUPLICATE KEY UPDATE email=email;
