const request = require('supertest');
const app = require('../src/server');
const pool = require('../src/config/db');

let token;

beforeAll(async () => {
  // clean up any previous test users (matches test_user@example.com)
  await pool.execute('DELETE FROM users WHERE email LIKE "test_user%"');
});

afterAll(async () => {
  await pool.end();
});

describe('Auth API', () => {
  const testUser = {
    name: 'Test User',
    email: 'test_user@example.com',
    password: 'pass1234',
  };

  test('register a new user', async () => {
    const res = await request(app).post('/api/auth/register').send(testUser);
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('user_id');
  });

  test('reject duplicate registration', async () => {
    const res = await request(app).post('/api/auth/register').send(testUser);
    expect(res.status).toBe(409);
  });

  test('login with correct credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: testUser.email,
      password: testUser.password,
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    token = res.body.token;
  });

  test('login fails with wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: testUser.email,
      password: 'wrongpass',
    });
    expect(res.status).toBe(401);
  });
});
