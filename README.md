# ⚡ Cloud Job Platform

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green?logo=node.js)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-5.x-lightgrey?logo=express)](https://expressjs.com/)
[![MySQL](https://img.shields.io/badge/MySQL-InnoDB-blue?logo=mysql)](https://www.mysql.com/)
[![Redis](https://img.shields.io/badge/Redis%20%2F%20Memurai-ZSET%20Queues-red?logo=redis)](https://redis.io/)
[![React](https://img.shields.io/badge/Frontend-React%2018%20%2B%20Vite-cyan?logo=react)](https://vitejs.dev/)
[![Jest](https://img.shields.io/badge/Testing-Jest%20%2B%20Supertest-crimson?logo=jest)](https://jestjs.io/)
[![License: ISC](https://img.shields.io/badge/License-ISC-yellow.svg)](https://opensource.org/licenses/ISC)

> **Production-grade, distributed, priority-based asynchronous job processing platform** engineering transactional consistency, lease heartbeats, and worker crash recovery using the **Transactional Outbox Pattern**, **MySQL ACID transactions**, and **Redis/Memurai Sorted Sets**.

---

## 📖 Table of Contents
- [Executive Summary & Problem Statement](#-executive-summary--problem-statement)
- [System Architecture](#-system-architecture)
- [Distributed Systems Patterns & Core Engineering](#-distributed-systems-patterns--core-engineering)
  - [1. Transactional Outbox Pattern (Dual-Write Protection)](#1-transactional-outbox-pattern-dual-write-protection)
  - [2. Priority Scheduling via Redis Sorted Sets (`ZSET`)](#2-priority-scheduling-via-redis-sorted-sets-zset)
  - [3. Token-Safe Distributed Leases & Heartbeat Renewal](#3-token-safe-distributed-leases--heartbeat-renewal)
  - [4. Worker Crash Recovery & At-Least-Once Delivery](#4-worker-crash-recovery--at-least-once-delivery)
  - [5. Queue Reconciliation](#5-queue-reconciliation)
- [Database Schema & Design Decisions](#-database-schema--design-decisions)
- [Security & Resilience Implementations](#-security--resilience-implementations)
- [Technology Stack](#-technology-stack)
- [Local Development Setup](#-local-development-setup)
- [API Documentation & Specification](#-api-documentation--specification)
- [Testing & Verification](#-testing--verification)
- [System Interview Talking Points](#-system-interview-talking-points)

---

## 🎯 Executive Summary & Problem Statement

### The Problem
In distributed architectures, user requests that trigger heavy computing (e.g. video transcode, CSV report generation, ML batch inference, PDF receipt generation) cannot be executed synchronously inside HTTP request cycles without:
1. Threatening request timeout errors (HTTP 504 / 502).
2. Tying up API HTTP thread pools / event loops.
3. **The Dual-Write Problem:** When writing data to MySQL and subsequently dispatching an event to a queue (like RabbitMQ or Redis), a network or server failure between the two operations corrupts data integrity—either the job is written to MySQL but never queued, or the queue processes an uncommitted database record.

### The Solution
This platform implements an enterprise **Transactional Outbox Engine**:
- Jobs and queue events are stored atomically within the **same MySQL database transaction**.
- A dedicated background **Dispatcher** independently polls and guarantees at-least-once delivery into Redis sorted sets.
- Independent **Workers** claim tasks using atomic, token-safe leases (`claim_token` + `lease_expires_at`), continuously refresh heartbeats, process tasks asynchronously, and gracefully recover orphaned jobs left behind by crashed worker processes.
- A **React + Vite Dashboard** offers real-time visibility into queue states, attempt counts, execution leases, and priority scores.

---

## 🏗 System Architecture

```mermaid
flowchart TD
    subgraph Client ["🖥️ Presentation Layer"]
        UI["React 18 + Vite SPA<br/>(Dashboard & Telemetry)"]
    end

    subgraph API ["⚡ API Layer (Express.js)"]
        Server["Express REST API<br/>(JWT Auth, Rate Limiter, Helmet)"]
        AuthCtrl["Auth Controller<br/>(Bcrypt, Token Issuer)"]
        JobCtrl["Job Controller<br/>(Transaction Coordinator)"]
    end

    subgraph Storage ["💾 Persistence Layer (MySQL)"]
        subgraph DBTransaction ["Atomic ACID Transaction"]
            Jobs["`**jobs** table`<br/>(Status: QUEUED, Priority 1-10)"]
            Outbox["`**job_outbox** table`<br/>(Event: JOB_CREATED, published_at: NULL)"]
        end
        Users["`**users** table`<br/>(RBAC / Ownership)"]
    end

    subgraph Broker ["⚡ In-Memory Queue (Redis / Memurai)"]
        JobQueue[("`job_queue` (ZSET)<br/>Score = Priority (1-10)<br/>Member = Job ID")]
        ProcQueue[("`job_processing` (ZSET)<br/>In-flight tracker")]
    end

    subgraph DispatcherService ["🚚 Outbox Dispatcher Daemon"]
        Dispatcher["Outbox Dispatcher<br/>• Polls published_at IS NULL<br/>• Idempotent ZADD<br/>• Batches of 50"]
    end

    subgraph WorkerPool ["⚙️ Distributed Worker Fleet"]
        Worker1["Worker Node 1<br/>• ZPOPMAX (Highest Priority)<br/>• Atomic FOR UPDATE claim<br/>• Heartbeat background loop"]
        Worker2["Worker Node 2<br/>• Lease recovery daemon<br/>• Queue reconciler"]
    end

    UI -->|JWT Authenticated Requests| Server
    Server --> AuthCtrl & JobCtrl
    AuthCtrl --> Users
    JobCtrl -->|1. BEGIN TRANSACTION| DBTransaction
    DBTransaction -->|2. Insert Job & Outbox Record| Jobs & Outbox
    
    Dispatcher -->|3. Read unpublished outbox events| Outbox
    Dispatcher -->|4. ZADD job_queue priority jobId| JobQueue
    Dispatcher -->|5. Mark published_at = NOW()| Outbox
    
    Worker1 & Worker2 -->|6. ZPOPMAX job_queue| JobQueue
    Worker1 -->|7. SELECT FOR UPDATE + Set claim_token & lease| Jobs
    Worker1 -->|8. Track In-Flight| ProcQueue
    Worker1 -->|9. Periodic Lease Heartbeat (10s)| Jobs
    Worker1 -->|10. Final Status COMPLETED or Retry FAILED| Jobs
    Worker1 -->|11. Remove from ProcQueue| ProcQueue
```

---

## 🔬 Distributed Systems Patterns & Core Engineering

### 1. Transactional Outbox Pattern (Dual-Write Protection)
When dispatching jobs, `jobController.js` wraps both table insertions within an explicit ACID transaction:
```javascript
connection = await pool.getConnection();
await connection.beginTransaction();

// 1. Insert domain entity
const [jobResult] = await connection.execute(
  `INSERT INTO jobs (user_id, type, priority, status) VALUES (?, ?, ?, 'QUEUED')`,
  [userId, type, priority]
);

// 2. Insert outbox message atomically
await connection.execute(
  `INSERT INTO job_outbox (job_id, event_type) VALUES (?, 'JOB_CREATED')`,
  [jobResult.insertId]
);

await connection.commit();
```
*If Redis is down during job creation, the API request still succeeds and no jobs are lost. The Outbox Dispatcher guarantees that as soon as Redis is reachable, the event will be published.*

---

### 2. Priority Scheduling via Redis Sorted Sets (`ZSET`)
Instead of standard FIFO queues (`LPUSH`/`RPOP`) where urgent workloads get blocked behind thousands of lower-priority background batch tasks, this platform utilizes a Redis **Sorted Set (`ZSET`)**:
- **Member:** `job_id`
- **Score:** Integer Priority `1` (lowest) to `10` (highest urgency)
- **Consumption:** `zPopMax("job_queue")` pops the highest score available in $O(\log N)$ time complexity.
- **Idempotency:** Re-publishing an existing job ID updates the score without creating duplicates.

---

### 3. Token-Safe Distributed Leases & Heartbeat Renewal
To prevent the **Split-Brain / Zombie Worker problem** (where a slow worker resumes execution after being assumed dead):
1. **Unique Claim Token:** The worker generates a `UUIDv4` `claim_token` on acquisition.
2. **Atomic SQL Transition:**
   ```sql
   UPDATE jobs
   SET status = 'PROCESSING',
       attempts = attempts + 1,
       lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 30 SECOND),
       claim_token = ?
   WHERE id = ? AND status = 'QUEUED';
   ```
3. **Heartbeat Renewal:** While the worker process is alive, an asynchronous timer executes every 10 seconds:
   ```sql
   UPDATE jobs
   SET lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 30 SECOND)
   WHERE id = ? AND status = 'PROCESSING' AND claim_token = ?;
   ```
4. **Guarded Commit:** When the worker completes execution, it only marks `COMPLETED` if its `claim_token` is still intact and unexpired. If the lease expired and another worker stole the task, the original worker safely discards its results.

---

### 4. Worker Crash Recovery & At-Least-Once Delivery
If a worker process experiences an unhandled exception, SIGKILL, or hardware shutdown:
- The `lease_expires_at` lapses after 30 seconds.
- The `recoverStuckJobs()` routine continuously queries:
  ```sql
  SELECT id, attempts, priority FROM jobs
  WHERE status = 'PROCESSING' AND lease_expires_at < CURRENT_TIMESTAMP;
  ```
- If `attempts < MAX_ATTEMPTS (3)`: resets `status = 'QUEUED'`, clears `claim_token`, and re-inserts the job into Redis `job_queue` with its original priority.
- If `attempts >= MAX_ATTEMPTS`: marks `status = 'FAILED'`.

---

### 5. Queue Reconciliation
If Redis experiences an in-memory crash or eviction:
- `reconcileQueuedJobs()` compares all MySQL jobs marked `status = 'QUEUED'` against the Redis `job_queue` and `job_processing` keys using `zScore()`.
- Missing jobs are re-enqueued automatically.

---

## 💾 Database Schema & Design Decisions

### Tables & Relationships

#### 1. `users`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `BIGINT UNSIGNED` | Primary Key, Auto Increment | Unique user identity |
| `name` | `VARCHAR(255)` | Not Null | User full name |
| `email` | `VARCHAR(255)` | Not Null, Unique | Email for authentication |
| `password_hash` | `VARCHAR(255)` | Not Null | Bcrypt hashed password (cost factor 10) |
| `created_at` | `TIMESTAMP` | Default CURRENT_TIMESTAMP | Registration timestamp |
| `updated_at` | `TIMESTAMP` | Nullable | Last profile update |

#### 2. `jobs`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `BIGINT UNSIGNED` | Primary Key, Auto Increment | Unique job identifier |
| `user_id` | `BIGINT UNSIGNED` | Foreign Key (`users.id` ON DELETE CASCADE) | Owner of the job |
| `type` | `VARCHAR(100)` | Not Null | Job task type (e.g., `email-notification`) |
| `priority` | `TINYINT UNSIGNED` | Not Null, Check (1-10) | Priority score |
| `status` | `ENUM` | Default `'QUEUED'` | `'QUEUED'`, `'PROCESSING'`, `'COMPLETED'`, `'FAILED'` |
| `attempts` | `INT UNSIGNED` | Default `0` | Execution attempt counter |
| `lease_expires_at`| `DATETIME` | Nullable | Active worker lease deadline |
| `claim_token` | `VARCHAR(36)` | Nullable | UUIDv4 token of currently assigned worker |
| `started_at` | `DATETIME` | Nullable | Timestamp of execution start |
| `completed_at` | `DATETIME` | Nullable | Timestamp of execution termination |
| `created_at` | `TIMESTAMP` | Default CURRENT_TIMESTAMP | Submission timestamp |
| `updated_at` | `TIMESTAMP` | Nullable | Record update timestamp |

*Indexes:* `idx_jobs_status (status)`, `idx_jobs_user (user_id)`

#### 3. `job_outbox`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `BIGINT UNSIGNED` | Primary Key, Auto Increment | Event identifier |
| `job_id` | `BIGINT UNSIGNED` | Foreign Key (`jobs.id` ON DELETE CASCADE) | Referenced job |
| `event_type` | `VARCHAR(50)` | Not Null | Event type name (`JOB_CREATED`) |
| `published_at` | `DATETIME` | Nullable | Timestamp when published to Redis |
| `created_at` | `TIMESTAMP` | Default CURRENT_TIMESTAMP | Event record creation |

*Indexes:* `idx_outbox_job (job_id)`, `idx_outbox_published (published_at)`

---

## 🛡 Security & Resilience Implementations

- **Password Security:** Salted and hashed using `bcryptjs` with salt round cost factor 10.
- **Stateless JWT Authorization:** Signed with HMAC-SHA256, 1-hour expiration, strictly verified via `authMiddleware.js`.
- **Tenant Isolation:** All job lookup queries require `WHERE id = ? AND user_id = ?`, rendering horizontal privilege escalation impossible.
- **DDoS & Brute Force Protection:** Express Rate Limiter guarding `/api/auth` with custom sliding windows (20 requests per 15 min).
- **HTTP Security Headers:** Integrated **Helmet** to enforce Content-Security-Policy, HSTS, X-Frame-Options (`SAMEORIGIN`), and X-Content-Type-Options (`nosniff`).
- **Structured Observability:** Integrated **Pino** and **Pino-HTTP** producing structured JSON logs with unique request IDs.
- **Fail-Fast Environment Validation:** `validateEnv.js` validates environment parameters during startup before bootstrapping database connections.

---

## 💻 Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Backend Runtime** | Node.js (v18+) | Non-blocking asynchronous event loop |
| **Framework** | Express.js 5.x | REST API routing and middleware pipeline |
| **Primary Database** | MySQL 5.7+ / 8.0+ / MariaDB | ACID storage, transactional integrity |
| **In-Memory Broker** | Redis / Memurai | Distributed Priority Sorted Sets (`ZSET`) |
| **Security** | Helmet, Express-Rate-Limit, Bcrypt, JWT | Security headers, rate limiting, hashing, authentication |
| **Frontend Framework**| React 18 + Vite | SPA frontend with instantaneous HMR |
| **Icons & Design** | Lucide React | Modern, clean dashboard metrics visualizer |
| **Testing Engine** | Jest & Supertest | End-to-end integration and API test suite |

---

## 🚀 Local Development Setup

### 1. Prerequisites
- **Node.js** (v18 or v20 recommended)
- **MySQL Server** (Native, WAMP, XAMPP, or Docker)
- **Redis / Memurai for Windows** running on default port `6379`

### 2. Database Setup
Execute the database initialization script:
```powershell
# Using native MySQL or WAMP:
Get-Content database/init.sql | mysql -u root -p
```

### 3. Environment Configuration
Create `backend/.env` (refer to `backend/.env.example`):
```env
PORT=8000
DB_HOST=127.0.0.1
DB_USER=root
DB_PASSWORD=
DB_NAME=cloud_job_platform
DB_PORT=3306

JWT_SECRET=your_super_secret_jwt_key_here
REDIS_URL=redis://127.0.0.1:6379
```

### 4. Install Dependencies
```bash
# Install root, backend and frontend dependencies
npm install
cd backend && npm install
cd ../frontend && npm install
cd ..
```

### 5. Running the Complete System
Open 4 terminal windows to run all components concurrently:

#### Terminal 1: REST API Server
```bash
npm run dev
# Starts on http://localhost:8000
```

#### Terminal 2: Outbox Dispatcher Daemon
```bash
npm run dispatcher
# Continuously dispatches unpublished MySQL outbox events into Redis
```

#### Terminal 3: Background Worker Daemon
```bash
npm run worker
# Continuously consumes jobs by priority, manages leases, and updates statuses
```

#### Terminal 4: React Dashboard Frontend
```bash
npm run frontend
# Vite dashboard live at http://localhost:5173
```

---

## 📡 API Documentation & Specification

### Authentication

#### `POST /api/auth/register`
Creates a new user profile.
```json
// Request Body
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "password": "securePassword123"
}

// Response (201 Created)
{
  "message": "User registered successfully",
  "user_id": 1
}
```

#### `POST /api/auth/login`
Validates credentials and returns JWT bearer token.
```json
// Request Body
{
  "email": "jane@example.com",
  "password": "securePassword123"
}

// Response (200 OK)
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "name": "Jane Doe",
    "email": "jane@example.com"
  }
}
```

---

### Job Management (Requires `Authorization: Bearer <TOKEN>`)

#### `POST /api/jobs`
Schedules a new job transactionally with the outbox table.
```json
// Request Body
{
  "type": "email-notification",
  "priority": 8
}

// Response (201 Created)
{
  "job_id": 42,
  "user_id": 1,
  "type": "email-notification",
  "priority": 8,
  "status": "QUEUED"
}
```

#### `GET /api/jobs`
Fetches all jobs belonging to the authenticated user.
```json
// Response (200 OK)
[
  {
    "id": 42,
    "user_id": 1,
    "type": "email-notification",
    "priority": 8,
    "status": "COMPLETED",
    "created_at": "2026-11-01T00:45:00.000Z"
  }
]
```

#### `GET /api/jobs/:id`
Fetches a single job by ID (strictly isolated to owner).
```json
// Response (200 OK)
{
  "id": 42,
  "user_id": 1,
  "type": "email-notification",
  "priority": 8,
  "status": "PROCESSING",
  "created_at": "2026-11-01T00:45:00.000Z"
}
```

---

## 🧪 Testing & Verification

Run the automated integration and unit test suite via Jest:
```bash
npm test
```

### Coverage Highlights:
- **`tests/auth.test.js`**: User registration, duplicate email rejection (409), valid login token delivery, invalid password rejection (401), rate-limit header emission.
- **`tests/job.test.js`**: Rejection of unauthenticated requests (401), priority range validation (400), atomic outbox table entry generation, multi-tenant isolation, and defense against cross-user ID tampering.

---

## 💡 System Interview Talking Points

When presenting this project in software engineering interviews, focus on these architecture and design decisions:

1. **Why the Outbox Pattern over direct Redis enqueueing in the HTTP handler?**
   * *Answer:* Direct enqueueing creates a dual-write problem. If the Redis call fails after database commit, the job is lost forever. If the DB rollback triggers after Redis publish, phantom jobs get processed. The Outbox pattern provides guaranteed at-least-once delivery by binding event emission to database transactions.
2. **How is the "Zombie Worker" problem handled?**
   * *Answer:* If a worker process hangs or stalls due to CPU starvation or network latency, another worker might take over after lease expiration. We guard completion using a unique `claim_token` (UUID). The finishing worker only updates status if its token is still matching and its lease is valid, preventing stale workers from overwriting fresher state.
3. **Why Redis Sorted Sets (`ZSET`) instead of Redis Streams or RabbitMQ for this use case?**
   * *Answer:* `ZSET` natively sorts jobs by numeric score ($O(\log N)$ extraction via `ZPOPMAX`). This provides dynamic priority re-ordering where a priority-10 job submitted later immediately jumps ahead of thousands of priority-1 background jobs without maintaining separate queues.
4. **How is idempotency preserved?**
   * *Answer:* In Redis, adding an existing `job_id` via `ZADD` simply refreshes its score rather than creating a duplicate item. In MySQL, state transitions are explicit (`WHERE id = ? AND status = 'QUEUED'`), ensuring competing workers cannot claim the same job twice.

---

## 📜 License
This project is open-source and licensed under the [ISC License](LICENSE).
