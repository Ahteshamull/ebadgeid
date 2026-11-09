// Regression for the production topology: the app lives on
// app.ebadgeid.com while the cookie-setting API lives on api.ebadgeid.com.
// The browser cannot read the API's host-only CSRF cookie, so it must obtain
// the matching synchronizer token from GET /api/auth/csrf and send it in the
// header for a cookie-authenticated POST. CSRF remains enforced throughout.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { csrfProtection, issueCsrfToken } = require('../middleware/csrfProtection');

test('CSRF bootstrap token authorizes a cookie session mutation while missing or invalid tokens remain blocked', async () => {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.get('/api/auth/csrf', (req, res) => res.json({ csrfToken: issueCsrfToken(res) }));
  app.use('/api', csrfProtection);
  app.post('/api/auth/login', (req, res) => {
    const csrfToken = issueCsrfToken(res); // login rotates it with the session
    res.cookie('ebadge_token', 'test-session', { httpOnly: true, sameSite: 'strict' });
    res.json({ csrfToken });
  });
  app.post('/api/protected', (req, res) => res.json({ ok: true }));

  const bootstrap = await request(app).get('/api/auth/csrf');
  assert.equal(bootstrap.status, 200);
  assert.equal(typeof bootstrap.body.csrfToken, 'string');

  // Login is sent with an old session cookie in this regression scenario;
  // the bootstrap header prevents the former "CSRF token required" failure.
  const bootstrapCookie = bootstrap.headers['set-cookie'].find((value) => value.startsWith('ebadge_csrf='));
  const login = await request(app).post('/api/auth/login')
    .set('Cookie', `ebadge_token=stale-session; ${bootstrapCookie.split(';')[0]}`)
    .set('X-CSRF-Token', bootstrap.body.csrfToken)
    .send({ username: 'admin@example.test', password: 'unused' });
  assert.equal(login.status, 200);
  assert.equal(typeof login.body.csrfToken, 'string');

  const authCookie = login.headers['set-cookie'].find((value) => value.startsWith('ebadge_token='));
  const rotatedCsrfCookie = login.headers['set-cookie'].find((value) => value.startsWith('ebadge_csrf='));
  const sessionCookies = `${authCookie.split(';')[0]}; ${rotatedCsrfCookie.split(';')[0]}`;
  assert.equal((await request(app).post('/api/protected').set('Cookie', sessionCookies).send({})).status, 403);
  assert.equal((await request(app).post('/api/protected').set('Cookie', sessionCookies).set('X-CSRF-Token', 'wrong-token').send({})).status, 403);
  assert.equal((await request(app).post('/api/protected').set('Cookie', sessionCookies).set('X-CSRF-Token', login.body.csrfToken).send({})).status, 200);
});
