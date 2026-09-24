const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../middleware/authMiddleware');

process.env.JWT_SECRET = 'test-secret-that-is-not-used-in-production';

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('rejects an unauthenticated request', async () => {
  const res = responseDouble();
  let nextCalled = false;
  await authMiddleware()({ header: () => undefined, cookies: {} }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('accepts the httpOnly OTP cookie for ticket tracking', async () => {
  const token = jwt.sign({ email: 'customer@example.com', user_type: 'otp' }, process.env.JWT_SECRET);
  const req = { header: () => undefined, cookies: { helpdesk_otp: token } };
  const res = responseDouble();
  let nextCalled = false;
  await authMiddleware(['otp'])(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user.email, 'customer@example.com');
  assert.equal(req.user.user_type, 'otp');
});

test('does not allow an OTP cookie on an agent-only route', async () => {
  const token = jwt.sign({ email: 'customer@example.com', user_type: 'otp' }, process.env.JWT_SECRET);
  const req = { header: () => undefined, cookies: { helpdesk_otp: token } };
  const res = responseDouble();
  let nextCalled = false;
  await authMiddleware(['agent'])(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('rejects a tampered cookie', async () => {
  const res = responseDouble();
  await authMiddleware()({ header: () => undefined, cookies: { helpdesk_token: 'tampered' } }, res, () => assert.fail('next must not run'));
  assert.equal(res.statusCode, 401);
  assert.match(res.body.message, /invalid|expired/i);
});
