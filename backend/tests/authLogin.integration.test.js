// tests/authLogin.integration.test.js
//
// Regression test for a real NoSQL injection found during the final QA
// pass (qa_final_harness.js): POST /api/auth/login did
// `User.findOne({ username })` with `username` taken straight from
// req.body, so a payload like {"username":{"$ne":null}} was passed
// through as a MongoDB query operator instead of a literal string match —
// classic NoSQL injection. Fixed in controllers/authController.js by
// rejecting any non-string username/password before the query ever runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcryptjs');

let mongod;

test.before(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('auth_login_test'));

  const AuthCred = require('../models/AuthCredentials');
  const UserProfile = require('../models/user_model');
  const passwordHash = await bcrypt.hash('RealPassword123!', 10);
  await AuthCred.create({ username: 'victim_user', password: passwordHash, user_role: 'user' });
  await UserProfile.create({
    username: 'victim_user', organization_code: 'ORG-X', first_name: 'Victim', last_name: 'User',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'victim@example.test', phone: '0', status: 'Active',
  });
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

function buildApp() {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.post('/api/auth/login', require('../controllers/authController').login);
  return app;
}

test('POST /api/auth/login rejects a NoSQL operator injection in username ({"$ne":null})', async () => {
  const res = await request(buildApp())
    .post('/api/auth/login')
    .send({ username: { $ne: null }, password: { $ne: null } })
    .set('Content-Type', 'application/json');
  assert.equal(res.status, 400);
  assert.equal(res.body.message, 'Invalid credentials');
});

test('POST /api/auth/login rejects a NoSQL operator injection in password only', async () => {
  const res = await request(buildApp())
    .post('/api/auth/login')
    .send({ username: 'victim_user', password: { $gt: '' } })
    .set('Content-Type', 'application/json');
  assert.equal(res.status, 400);
});

test('POST /api/auth/login still works normally with real string credentials', async () => {
  const res = await request(buildApp())
    .post('/api/auth/login')
    .send({ username: 'victim_user', password: 'RealPassword123!' })
    .set('Content-Type', 'application/json');
  assert.equal(res.status, 200);
  assert.equal(res.body.username, 'victim_user');
  assert.equal(res.body.organization_code, 'ORG-X');
});

test('POST /api/auth/login accepts the institutional email mapped to the same account', async () => {
  const res = await request(buildApp())
    .post('/api/auth/login')
    .send({ username: 'victim@example.test', password: 'RealPassword123!' })
    .set('Content-Type', 'application/json');
  assert.equal(res.status, 200);
  assert.equal(res.body.username, 'victim_user');
  assert.equal(res.body.organization_code, 'ORG-X');
  assert.ok(res.headers['set-cookie']?.some((value) => value.startsWith('ebadge_token=')));
});

test('a production login clears the legacy parent-domain session cookie before issuing the fresh cookie', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCookieDomain = process.env.AUTH_COOKIE_DOMAIN;
  process.env.NODE_ENV = 'production';
  process.env.AUTH_COOKIE_DOMAIN = '.ebadgeid.com';

  try {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ username: 'victim@example.test', password: 'RealPassword123!' });
    assert.equal(res.status, 200);

    const authCookies = res.headers['set-cookie'].filter((value) => value.startsWith('ebadge_token='));
    // Express 5's res.clearCookie() explicitly deletes `maxAge` before
    // serializing (see node_modules/express/lib/response.js) -- it expires
    // a cookie via `Expires=<a date in the past>`, never `Max-Age=0`. Both
    // are equally real, immediate expiration to every browser; this
    // asserts on what Express actually emits instead of a signature it
    // never produces.
    assert.ok(authCookies.some((value) => /Domain=\.ebadgeid\.com/i.test(value) && /Expires=Thu, 01 Jan 1970/.test(value)),
      'the stale parent-domain cookie must be expired');
    assert.ok(authCookies.some((value) => /Domain=\.ebadgeid\.com/i.test(value) && /Max-Age=86400/.test(value)),
      'the fresh session cookie must still be issued after cleanup');
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousCookieDomain === undefined) delete process.env.AUTH_COOKIE_DOMAIN;
    else process.env.AUTH_COOKIE_DOMAIN = previousCookieDomain;
  }
});

test('POST /api/auth/login rejects a wrong string password (baseline, not affected by the fix)', async () => {
  const res = await request(buildApp())
    .post('/api/auth/login')
    .send({ username: 'victim_user', password: 'WrongPassword' })
    .set('Content-Type', 'application/json');
  assert.equal(res.status, 400);
});
