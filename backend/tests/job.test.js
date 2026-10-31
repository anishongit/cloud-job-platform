const request = require('supertest');
const app = require('../src/server');
const pool = require('../src/config/db');

let userToken1;
let userToken2;
let user1Id;
let user2Id;
let createdJobId;

beforeAll(async () => {
  // Clean up existing test records
  await pool.execute('DELETE FROM job_outbox');
  await pool.execute('DELETE FROM jobs');
  await pool.execute('DELETE FROM users WHERE email LIKE "jobtest_%"');

  // Register user 1
  const user1 = {
    name: 'Job Tester One',
    email: 'jobtest_1@example.com',
    password: 'password123'
  };
  const regRes1 = await request(app).post('/api/auth/register').send(user1);
  user1Id = regRes1.body.user_id;

  const loginRes1 = await request(app).post('/api/auth/login').send({
    email: user1.email,
    password: user1.password
  });
  userToken1 = loginRes1.body.token;

  // Register user 2
  const user2 = {
    name: 'Job Tester Two',
    email: 'jobtest_2@example.com',
    password: 'password123'
  };
  const regRes2 = await request(app).post('/api/auth/register').send(user2);
  user2Id = regRes2.body.user_id;

  const loginRes2 = await request(app).post('/api/auth/login').send({
    email: user2.email,
    password: user2.password
  });
  userToken2 = loginRes2.body.token;
});

afterAll(async () => {
  await pool.end();
});

describe('Job Management & Access Control API', () => {
  test('rejects job creation without authorization header', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .send({ type: 'email-report', priority: 5 });

    expect(res.status).toBe(401);
  });

  test('rejects job creation with invalid priority or missing type', async () => {
    const res1 = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${userToken1}`)
      .send({ type: '', priority: 5 });

    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${userToken1}`)
      .send({ type: 'report', priority: 15 });

    expect(res2.status).toBe(400);
  });

  test('successfully creates a job and records transactional outbox entry', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${userToken1}`)
      .send({ type: 'export-csv', priority: 8 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('job_id');
    expect(res.body.priority).toBe(8);
    expect(res.body.status).toBe('QUEUED');
    createdJobId = res.body.job_id;

    // Verify outbox entry was created transactionally
    const [outboxRows] = await pool.execute(
      'SELECT * FROM job_outbox WHERE job_id = ? AND event_type = ?',
      [createdJobId, 'JOB_CREATED']
    );
    expect(outboxRows.length).toBe(1);
    expect(outboxRows[0].published_at).toBeNull();
  });

  test('lists only jobs owned by the authenticated user', async () => {
    const res = await request(app)
      .get('/api/jobs')
      .set('Authorization', `Bearer ${userToken1}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].id).toBe(createdJobId);

    // User 2 should have 0 jobs
    const resUser2 = await request(app)
      .get('/api/jobs')
      .set('Authorization', `Bearer ${userToken2}`);

    expect(resUser2.status).toBe(200);
    expect(resUser2.body.length).toBe(0);
  });

  test('allows owner to fetch their job by ID', async () => {
    const res = await request(app)
      .get(`/api/jobs/${createdJobId}`)
      .set('Authorization', `Bearer ${userToken1}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdJobId);
    expect(res.body.type).toBe('export-csv');
  });

  test('prevents another user from accessing a job they do not own (404/Access Control)', async () => {
    const res = await request(app)
      .get(`/api/jobs/${createdJobId}`)
      .set('Authorization', `Bearer ${userToken2}`);

    expect(res.status).toBe(404);
  });
});
