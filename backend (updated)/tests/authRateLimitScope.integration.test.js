// tests/authRateLimitScope.integration.test.js
//
// Regression test for a real production risk found by browser-driven QA
// (qa_final_harness.js + a real Next.js frontend hitting a real backend):
// the strict login/brute-force limiter (20 req/15min) used to be mounted
// on the whole /api/auth prefix, including GET /me and POST /logout.
// Those aren't brute-forceable (they require an already-valid session,
// not a guessed credential) but shared the same bucket -- and since
// useSession() is called independently by several frontend components
// with no shared cache, a handful of normal page loads was enough to
// exhaust the budget and lock an already-authenticated admin out of their
// own session. Fixed in api.js by scoping authLimiter to only
// /login, /register, /activate, /resend-activation.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';

let mongod;
let app;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('GET /api/auth/me is NOT rate-limited by the login/brute-force limiter (25 rapid unauthenticated calls, none 429)', async () => {
  for (let i = 0; i < 25; i++) {
    const res = await request(app).get('/api/auth/me');
    assert.equal(res.status, 401, `call #${i + 1} should be 401 (no token), not rate-limited`);
  }
});

test('POST /api/auth/login IS still rate-limited (the actual brute-force surface)', async () => {
  let sawRateLimit = false;
  for (let i = 0; i < 25; i++) {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'someone_who_does_not_exist', password: 'wrong' })
      .set('Content-Type', 'application/json');
    if (res.status === 429) { sawRateLimit = true; break; }
  }
  assert.equal(sawRateLimit, true, 'expected a 429 within 25 rapid login attempts');
});

// --- Semantica de 401 vs 403 ---------------------------------------------
// A malformed, expired or wrongly-signed token is an AUTHENTICATION failure
// and must answer 401; 403 is reserved for "we know who you are and you may
// not do this". They used to share 403, which meant the axios client never
// redirected an expired session back to login, while apiFetch compensated by
// treating every 403 as a dead session -- logging out a perfectly valid user
// who happened to click an admin-only action.
test('an invalid, expired or forged token answers 401, not 403', async () => {
  const jwt = require('jsonwebtoken');
  const cases = {
    malformed: 'definitely.not.a.token',
    expired: jwt.sign({ id: 'x', username: 'y', role: 'admin', organization_code: 'ORG-X' },
      process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '-1h' }),
    'signed with another key': jwt.sign({ id: 'x', username: 'y', role: 'admin', organization_code: 'ORG-X' },
      'a-different-secret-entirely', { algorithm: 'HS256' }),
  };
  for (const [label, token] of Object.entries(cases)) {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 401, `a token ${label} must be 401, got ${res.status}`);
  }
});

test('missing credentials answer 401 too, so the two are consistent', async () => {
  const res = await request(app).get('/api/auth/me');
  assert.equal(res.status, 401);
});
