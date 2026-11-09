// tests/requireApiKey.test.js
//
// The ApiKey model + CRUD existed before this round with a
// requests_allowed_per_minute field that nothing ever checked — a key
// could be created and would do absolutely nothing when used. This locks
// in the part of the new middleware that doesn't need a live database: the
// "no key at all" rejection, which is the most common integration mistake
// (forgetting the header) and the one most worth having a fast, certain
// test for.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
const { requireApiKey } = require('../middleware/requireApiKey');

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

test('requireApiKey rejects a request with no X-API-Key header', async () => {
  const req = { headers: {} };
  const res = mockRes();
  let nextCalled = false;
  await requireApiKey(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});
