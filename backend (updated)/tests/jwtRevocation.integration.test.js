// tests/jwtRevocation.integration.test.js
//
// Security fix, found during an audit round: POST /api/auth/logout only
// ever cleared the browser's cookie -- the JWT itself, if captured
// beforehand (copied out of localStorage, sniffed from a misconfigured
// proxy, whatever), stayed fully valid against every protected route for
// the rest of its 1-day life regardless of the user having "logged out".
// This proves the real fix end to end, against the real HTTP routes: log
// in for real, use the token successfully, log out, then confirm the
// EXACT SAME token (not a new one) is rejected by a real protected route
// -- not just that logout "succeeds", but that revocation actually took
// effect.
//
// Same fake-Redis-client injection point (utils/cache.js's
// _setClientForTesting) already established by tests/cache.test.js and the
// SAML replay tests, since a real Redis server isn't reachable in the
// standard `npm test` run.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcryptjs');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';

function createFakeRedisClient() {
  const store = new Map();
  return {
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key, value, mode, ttlSeconds) {
      const expiresAt = mode === 'EX' ? Date.now() + ttlSeconds * 1000 : null;
      store.set(key, { value, expiresAt });
      return 'OK';
    },
    async del(key) {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    },
  };
}

let mongod;
let app;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const { _setClientForTesting } = require('../utils/cache');
  _setClientForTesting(createFakeRedisClient());

  const express = require('express');
  const cookieParser = require('cookie-parser');
  const { login, logout } = require('../controllers/authController');
  const { requireAuth } = require('../middleware/requireAuth');

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.post('/api/auth/login', login);
  app.post('/api/auth/logout', logout);
  app.get('/protected', requireAuth, (req, res) => res.status(200).json({ ok: true, username: req.user.username }));

  const AuthCred = require('../models/AuthCredentials');
  const UserProfile = require('../models/user_model');
  const passwordHash = await bcrypt.hash('RealPassword123!', 12);
  await AuthCred.create({ username: 'revoke_test_user', password: passwordHash, user_role: 'user' });
  await UserProfile.create({
    username: 'revoke_test_user', organization_code: 'ORG-REVOKE', first_name: 'R', last_name: 'U',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'revoke@example.test', phone: '0', status: 'Active',
  });
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('a token still works against a real protected route right after login', async () => {
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'revoke_test_user', password: 'RealPassword123!' });
  assert.equal(loginRes.status, 200);
  const token = loginRes.headers['set-cookie'].join(';').match(/ebadge_token=([^;]+)/)[1];

  const before = await request(app).get('/protected').set('Authorization', `Bearer ${decodeURIComponent(token)}`);
  assert.equal(before.status, 200);
  assert.equal(before.body.username, 'revoke_test_user');
});

test('the exact same token is rejected by a real protected route after logout -- real revocation, not just a cleared cookie', async () => {
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'revoke_test_user', password: 'RealPassword123!' });
  const rawCookie = loginRes.headers['set-cookie'].join(';');
  const token = decodeURIComponent(rawCookie.match(/ebadge_token=([^;]+)/)[1]);

  const beforeLogout = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
  assert.equal(beforeLogout.status, 200, 'sanity check -- the token must actually work before logout');

  const logoutRes = await request(app)
    .post('/api/auth/logout')
    .set('Cookie', `ebadge_token=${encodeURIComponent(token)}`);
  assert.equal(logoutRes.status, 200);

  const afterLogout = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
  assert.equal(afterLogout.status, 401, `the same token must be rejected after logout, got ${afterLogout.status}: ${JSON.stringify(afterLogout.body)}`);
});

test('logging out one session never revokes a different session for the same user', async () => {
  const login1 = await request(app).post('/api/auth/login').send({ username: 'revoke_test_user', password: 'RealPassword123!' });
  const token1 = decodeURIComponent(login1.headers['set-cookie'].join(';').match(/ebadge_token=([^;]+)/)[1]);
  const login2 = await request(app).post('/api/auth/login').send({ username: 'revoke_test_user', password: 'RealPassword123!' });
  const token2 = decodeURIComponent(login2.headers['set-cookie'].join(';').match(/ebadge_token=([^;]+)/)[1]);
  assert.notEqual(token1, token2, 'sanity check -- two real logins must produce two different tokens (different jti)');

  await request(app).post('/api/auth/logout').set('Cookie', `ebadge_token=${encodeURIComponent(token1)}`);

  const session1After = await request(app).get('/protected').set('Authorization', `Bearer ${token1}`);
  assert.equal(session1After.status, 401);
  const session2After = await request(app).get('/protected').set('Authorization', `Bearer ${token2}`);
  assert.equal(session2After.status, 200, 'a different, still-active session must be unaffected by another session logging out');
});
