// tests/requireAuth.test.js
//
// Covers the auth guard applied to every route that used to be public
// (see AUDIT_FIXES.md, hallazgo 1.1). This is the single highest-value
// thing to have a regression test for in this codebase: if a future route
// forgets to import this middleware, these tests won't catch that
// directly, but they do lock in the contract requireAuth/requireAdmin must
// honor, so a broken refactor of the middleware itself gets caught.
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';

const { requireAuth, requireAdmin, requireAdminOrTeacher, requireOwnOrg } = require('../middleware/requireAuth');

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

test('requireAuth rejects requests with no token', () => {
  const req = { headers: {} };
  const res = mockRes();
  let nextCalled = false;
  requireAuth(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireAuth rejects an invalid/garbage token with 401, not 403', () => {
  const req = { headers: { authorization: 'Bearer not-a-real-jwt' } };
  const res = mockRes();
  let nextCalled = false;
  requireAuth(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  // 401: there is no valid identity at all. 403 is reserved for a KNOWN
  // identity that may not perform the action. They used to share 403, which
  // meant the axios client never sent an expired session back to login,
  // while apiFetch compensated by treating every 403 as a dead session --
  // logging out a valid user who merely clicked an admin-only action.
  assert.equal(res.statusCode, 401);
});

test('requireAuth accepts a valid token and normalizes req.user', async () => {
  const token = jwt.sign(
    { id: 'u1', username: 'alice', role: 'user', organization_code: 'ORG1' },
    process.env.JWT_SECRET
  );
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = mockRes();
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.user, {
    id: 'u1',
    username: 'alice',
    role: 'user',
    organization_code: 'ORG1'
  });
});

test('requireAdmin blocks a non-admin user', () => {
  const req = { user: { role: 'user' } };
  const res = mockRes();
  let nextCalled = false;
  requireAdmin(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('requireAdmin allows an admin user through', () => {
  const req = { user: { role: 'admin' } };
  const res = mockRes();
  let nextCalled = false;
  requireAdmin(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

// LOW-01 (audit finding): requireAdminOrTeacher is the scoped-to-specific-
// route-files carve-out (goal_routes.js, userRoutes.js's create/list) that
// lets a 'teacher' account -- newly possible at all since AuthCredentials'
// enum now includes it -- reach exactly what the frontend already promised
// it, without touching requireAdmin itself (which many other, more
// sensitive routes still use unchanged).
test('requireAdminOrTeacher blocks a plain user', () => {
  const req = { user: { role: 'user' } };
  const res = mockRes();
  let nextCalled = false;
  requireAdminOrTeacher(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('requireAdminOrTeacher allows a teacher through', () => {
  const req = { user: { role: 'teacher' } };
  const res = mockRes();
  let nextCalled = false;
  requireAdminOrTeacher(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

test('requireAdminOrTeacher still allows an admin through', () => {
  const req = { user: { role: 'admin' } };
  const res = mockRes();
  let nextCalled = false;
  requireAdminOrTeacher(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

test('requireOwnOrg blocks cross-organization access (IDOR)', () => {
  const middleware = requireOwnOrg();
  const req = { params: { organization_code: 'OTHER_ORG' }, user: { organization_code: 'MY_ORG' } };
  const res = mockRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('requireOwnOrg allows same-organization access', () => {
  const middleware = requireOwnOrg();
  const req = { params: { organization_code: 'MY_ORG' }, user: { organization_code: 'MY_ORG' } };
  const res = mockRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

// Security regression test -- reproduces the exact finding: a token
// captured before logout must stop working once logout actually revokes
// it, not just once it naturally expires a day later. Uses the same
// fake-Redis-client injection point (utils/cache.js's _setClientForTesting)
// tests/cache.test.js and the SAML replay tests already established, since
// a real Redis server isn't reachable in the standard `npm test` run.
test('requireAuth rejects a token whose jti has been revoked (real logout), and still accepts a different, non-revoked token', async () => {
  function createFakeRedisClient() {
    const store = new Map();
    return {
      async get(key) { return store.has(key) ? store.get(key) : null; },
      async set(key, value) { store.set(key, value); return 'OK'; },
      async del(key) { const existed = store.has(key); store.delete(key); return existed ? 1 : 0; },
    };
  }
  const { _setClientForTesting } = require('../utils/cache');
  const { revokedTokenKey } = require('../utils/tokenRevocation');
  const { setCached } = require('../utils/cache');
  _setClientForTesting(createFakeRedisClient());

  const revokedJti = 'revoked-session-id';
  await setCached(revokedTokenKey(revokedJti), true, 900);

  const revokedToken = jwt.sign(
    { id: 'u1', username: 'alice', role: 'user', organization_code: 'ORG1', jti: revokedJti },
    process.env.JWT_SECRET
  );
  const stillValidToken = jwt.sign(
    { id: 'u1', username: 'alice', role: 'user', organization_code: 'ORG1', jti: 'a-different-session-id' },
    process.env.JWT_SECRET
  );

  const revokedReq = { headers: { authorization: `Bearer ${revokedToken}` } };
  const revokedRes = mockRes();
  let revokedNextCalled = false;
  await requireAuth(revokedReq, revokedRes, () => { revokedNextCalled = true; });
  assert.equal(revokedNextCalled, false, 'a revoked jti must never reach next()');
  assert.equal(revokedRes.statusCode, 401);

  const validReq = { headers: { authorization: `Bearer ${stillValidToken}` } };
  const validRes = mockRes();
  let validNextCalled = false;
  await requireAuth(validReq, validRes, () => { validNextCalled = true; });
  assert.equal(validNextCalled, true, 'revoking one session must never revoke a different, unrelated session');
});
