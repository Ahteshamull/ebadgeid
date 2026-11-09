// tests/enforcePlanLimits.test.js
//
// Tests the actual decision logic in middleware/enforcePlanLimits.js:
// given a plan's limits and a current usage count, does it correctly
// allow or block (402)? Mongoose model methods are stubbed directly
// (countDocuments/findOne/findOneAndUpdate) rather than requiring a live
// MongoDB connection — this is testing the enforcement logic itself, not
// the database.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';

const Organization = require('../models/organization_schema');
const Plan = require('../models/plan_schema');
const Users = require('../models/user_model');
const Credential = require('../models/credentialSchema');
const UsageCounter = require('../models/usageCounter');
const { checkUserLimit, checkCredentialLimit, trackAndCheckApiUsage } = require('../middleware/enforcePlanLimits');

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function withStubs(stubs, fn) {
  const originals = {};
  for (const [obj, methods] of stubs) {
    for (const [name, impl] of Object.entries(methods)) {
      originals[`${obj.modelName}.${name}`] = obj[name];
      obj[name] = impl;
    }
  }
  return fn().finally(() => {
    for (const [obj, methods] of stubs) {
      for (const name of Object.keys(methods)) {
        obj[name] = originals[`${obj.modelName}.${name}`];
      }
    }
  });
}

test('checkUserLimit blocks (402) once the plan\'s max_users is reached', async () => {
  await withStubs([
    [Organization, { findOne: async () => ({ organization_code: 'ORG1', plan: 'Free' }) }],
    [Plan, { findOne: async () => ({ name: 'Free', max_users: 5, max_credentials_per_month: 25, max_api_calls_per_month: 500 }) }],
    [Users, { countDocuments: async () => 5 }], // already at the limit
  ], async () => {
    const req = { user: { organization_code: 'ORG1' } };
    const res = mockRes();
    let nextCalled = false;
    await checkUserLimit(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 402);
    assert.equal(res.body.limit, 5);
  });
});

test('checkUserLimit allows the request when under the limit', async () => {
  await withStubs([
    [Organization, { findOne: async () => ({ organization_code: 'ORG1', plan: 'Free' }) }],
    [Plan, { findOne: async () => ({ name: 'Free', max_users: 5, max_credentials_per_month: 25, max_api_calls_per_month: 500 }) }],
    [Users, { countDocuments: async () => 2 }],
  ], async () => {
    const req = { user: { organization_code: 'ORG1' } };
    const res = mockRes();
    let nextCalled = false;
    await checkUserLimit(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  });
});

test('checkUserLimit never blocks an Enterprise plan (unlimited = -1)', async () => {
  await withStubs([
    [Organization, { findOne: async () => ({ organization_code: 'ORG1', plan: 'Enterprise' }) }],
    [Plan, { findOne: async () => ({ name: 'Enterprise', max_users: -1, max_credentials_per_month: -1, max_api_calls_per_month: -1 }) }],
    [Users, { countDocuments: async () => 99999 }],
  ], async () => {
    const req = { user: { organization_code: 'ORG1' } };
    const res = mockRes();
    let nextCalled = false;
    await checkUserLimit(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
  });
});

test('checkCredentialLimit blocks once this month\'s issued count reaches the plan limit', async () => {
  await withStubs([
    [Organization, { findOne: async () => ({ organization_code: 'ORG1', plan: 'Free' }) }],
    [Plan, { findOne: async () => ({ name: 'Free', max_users: 5, max_credentials_per_month: 25, max_api_calls_per_month: 500 }) }],
    [Credential, { countDocuments: async () => 25 }],
  ], async () => {
    const req = { user: { organization_code: 'ORG1' } };
    const res = mockRes();
    let nextCalled = false;
    await checkCredentialLimit(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 402);
  });
});

test('checkUserLimit fails closed (blocks) when the org has a plan name with no matching Plan document', async () => {
  await withStubs([
    [Organization, { findOne: async () => ({ organization_code: 'ORG1', plan: 'SomeDeletedPlan' }) }],
    [Plan, { findOne: async () => null }],
  ], async () => {
    const req = { user: { organization_code: 'ORG1' } };
    const res = mockRes();
    let nextCalled = false;
    await checkUserLimit(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });
});

test('trackAndCheckApiUsage increments the counter and blocks once the monthly quota is exceeded', async () => {
  await withStubs([
    [Organization, { findOne: async () => ({ organization_code: 'ORG1', plan: 'Free' }) }],
    [Plan, { findOne: async () => ({ name: 'Free', max_users: 5, max_credentials_per_month: 25, max_api_calls_per_month: 500 }) }],
    [UsageCounter, { findOneAndUpdate: async () => ({ api_calls: 501 }) }], // just went over
  ], async () => {
    const req = { user: { organization_code: 'ORG1' } };
    const res = mockRes();
    let nextCalled = false;
    await trackAndCheckApiUsage(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 402);
  });
});
