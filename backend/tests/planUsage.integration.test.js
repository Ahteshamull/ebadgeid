// tests/planUsage.integration.test.js
//
// Plan + consumption reporting, and the tenant isolation around it.
//
// The isolation tests here are the important ones: this endpoint reports
// how much of its quota an organization has consumed, which is exactly
// the kind of commercial information one tenant must never be able to
// read about another. An admin is allowed its own organization and
// nothing else; a platform admin is allowed everything, because that is
// its job.
//
// The consumption figures are asserted against REAL seeded documents
// (users, credentials, contracts) rather than a stubbed service, so a
// change that makes the dashboard disagree with what
// middleware/enforcePlanLimits.js actually enforces will fail here.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only_min_32';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';

let mongod;
let app;
let Organization;
let Plan;
let Users;
let Credential;

const tokenFor = (organization_code, role) => jwt.sign(
  { id: crypto.randomUUID(), username: `${role}@${organization_code}.test`, role, organization_code },
  process.env.JWT_SECRET,
  { algorithm: 'HS256' },
);

const seedUsers = (organization_code, howMany) => Promise.all(
  Array.from({ length: howMany }, (_, i) => Users.create({
    username: `member${i}@${organization_code}.test`, organization_code,
    first_name: 'M', last_name: String(i), designation: 'Staff',
    city: 'C', state: 'S', country: 'CR', email: `member${i}@${organization_code}.test`,
    phone: '0', status: 'active',
  })),
);

const seedCredentials = (organization_code, howMany) => Promise.all(
  Array.from({ length: howMany }, (_, i) => Credential.create({
    credential_code: `CRED-${organization_code}-${String(i).padStart(4, '0')}`,
    credential_title: 'Test', credential_issue_date: '2026-08-01', credential_expiry_date: '2028-08-01',
    credential_pic_url: 'http://localhost:9000/uploads/x.png',
    achiever_username: `member${i}@${organization_code}.test`,
    organization_code, credential_status: 'Issued',
    credential_blockchain_hashes: crypto.createHash('sha256').update(`${organization_code}-${i}`).digest('hex'),
  })),
);

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  Organization = require('../models/organization_schema');
  Plan = require('../models/plan_schema');
  Users = require('../models/user_model');
  Credential = require('../models/credentialSchema');

  await Plan.create({ name: 'Basic', max_users: 25, max_credentials_per_month: 250, max_api_calls_per_month: 5000, is_free: false });
  await Plan.create({ name: 'Enterprise', max_users: -1, max_credentials_per_month: -1, max_api_calls_per_month: -1, is_free: false });

  await Organization.create({
    organization_code: 'ORG-ALPHA', name: 'Alpha', city: 'C', state: 'S', country: 'CR',
    email: 'a@test.local', phone: '0', status: 'ACTIVE', plan: 'Basic',
  });
  await Organization.create({
    organization_code: 'ORG-BETA', name: 'Beta', city: 'C', state: 'S', country: 'CR',
    email: 'b@test.local', phone: '0', status: 'ACTIVE', plan: 'Enterprise',
  });
  await Organization.create({
    organization_code: 'SUPER_AD_ORG', name: 'Platform', city: 'C', state: 'S', country: 'CR',
    email: 'p@test.local', phone: '0', status: 'ACTIVE', plan: 'Basic',
  });

  await seedUsers('ORG-ALPHA', 3);
  await seedCredentials('ORG-ALPHA', 4);
  await seedUsers('ORG-BETA', 7);
  await seedCredentials('ORG-BETA', 2);
});

test.after(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test('an admin sees its own real plan and consumption, computed from actual documents', async () => {
  const res = await request(app).get('/api/organizations/plan-usage')
    .set('Authorization', `Bearer ${tokenFor('ORG-ALPHA', 'admin')}`);
  assert.equal(res.status, 200);

  assert.equal(res.body.organization.organization_code, 'ORG-ALPHA');
  assert.equal(res.body.plan.name, 'Basic');
  assert.equal(res.body.plan.configured, true);
  assert.ok(res.body.plan.started_at, 'the plan start date must be reported');
  assert.ok(res.body.plan.quota_resets_at, 'the quota reset date must be reported');

  // Real counts, not placeholders.
  assert.equal(res.body.usage.users.used, 3);
  assert.equal(res.body.usage.users.limit, 25);
  assert.equal(res.body.usage.users.remaining, 22);

  assert.equal(res.body.usage.credentials_this_month.used, 4);
  assert.equal(res.body.usage.credentials_this_month.limit, 250);
  assert.equal(res.body.usage.credentials_this_month.remaining, 246);

  // A badge IS a credential in this product -- same figure, deliberately,
  // rather than a second invented quota.
  assert.deepEqual(res.body.usage.badges_this_month, res.body.usage.credentials_this_month);
});

test('an unlimited plan reports no remaining ceiling instead of a fabricated one', async () => {
  const res = await request(app).get('/api/organizations/plan-usage')
    .set('Authorization', `Bearer ${tokenFor('ORG-BETA', 'admin')}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.usage.users.unlimited, true);
  assert.equal(res.body.usage.users.remaining, null);
  assert.equal(res.body.usage.users.used, 7, 'real usage is still reported for an unlimited plan');
});

test('contracts are reported as real usage with no invented quota', async () => {
  const res = await request(app).get('/api/organizations/plan-usage')
    .set('Authorization', `Bearer ${tokenFor('ORG-ALPHA', 'admin')}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.usage.contracts.limit, null, 'no plan tier caps contracts -- must not show a made-up limit');
  assert.equal(res.body.usage.contracts.metered, false);
  assert.equal(typeof res.body.usage.contracts.used, 'number');
});

// --- Tenant isolation: the security core of this endpoint ---

test('an admin CANNOT read another organization plan or consumption', async () => {
  const res = await request(app).get('/api/organizations/plan-usage/ORG-BETA')
    .set('Authorization', `Bearer ${tokenFor('ORG-ALPHA', 'admin')}`);
  assert.equal(res.status, 403, 'cross-tenant commercial data must be refused');
  assert.ok(!JSON.stringify(res.body).includes('Beta'), 'no data about the other organization may leak in the error');
});

test('an admin explicitly naming its OWN organization is allowed', async () => {
  const res = await request(app).get('/api/organizations/plan-usage/ORG-ALPHA')
    .set('Authorization', `Bearer ${tokenFor('ORG-ALPHA', 'admin')}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.organization.organization_code, 'ORG-ALPHA');
});

test('a platform admin can read any organization', async () => {
  for (const code of ['ORG-ALPHA', 'ORG-BETA']) {
    const res = await request(app).get(`/api/organizations/plan-usage/${code}`)
      .set('Authorization', `Bearer ${tokenFor('SUPER_AD_ORG', 'platform_admin')}`);
    assert.equal(res.status, 200, `platform admin must be able to read ${code}`);
    assert.equal(res.body.organization.organization_code, code);
  }
});

test('the consolidated view is platform-admin only', async () => {
  const refused = await request(app).get('/api/organizations/plan-usage/all')
    .set('Authorization', `Bearer ${tokenFor('ORG-ALPHA', 'admin')}`);
  assert.equal(refused.status, 403, 'an admin must never get the cross-organization roll-up');

  const allowed = await request(app).get('/api/organizations/plan-usage/all')
    .set('Authorization', `Bearer ${tokenFor('SUPER_AD_ORG', 'platform_admin')}`);
  assert.equal(allowed.status, 200);
  assert.ok(Array.isArray(allowed.body.organizations));
  assert.ok(allowed.body.organizations.length >= 3);
});

test('the consolidated view and the per-organization view report identical numbers', async () => {
  // This is the "Admin and Super Admin must agree" guarantee: both come
  // from one function, and this fails the moment they stop matching.
  const superToken = tokenFor('SUPER_AD_ORG', 'platform_admin');
  const all = await request(app).get('/api/organizations/plan-usage/all').set('Authorization', `Bearer ${superToken}`);
  const adminView = await request(app).get('/api/organizations/plan-usage')
    .set('Authorization', `Bearer ${tokenFor('ORG-ALPHA', 'admin')}`);

  const fromRollup = all.body.organizations.find(o => o.organization.organization_code === 'ORG-ALPHA');
  assert.ok(fromRollup, 'the roll-up must include the organization');
  assert.deepEqual(fromRollup.usage.users, adminView.body.usage.users);
  assert.deepEqual(fromRollup.usage.credentials_this_month, adminView.body.usage.credentials_this_month);
  assert.equal(fromRollup.plan.name, adminView.body.plan.name);
});

test('an unauthenticated caller gets nothing', async () => {
  const res = await request(app).get('/api/organizations/plan-usage');
  assert.equal(res.status, 401);
});

test('a plan name with no matching Plan document is surfaced, not silently zeroed', async () => {
  await Organization.create({
    organization_code: 'ORG-DRIFT', name: 'Drift', city: 'C', state: 'S', country: 'CR',
    email: 'd@test.local', phone: '0', status: 'ACTIVE', plan: 'Premium', // seeded Plan does not exist in this test
  });
  const res = await request(app).get('/api/organizations/plan-usage/ORG-DRIFT')
    .set('Authorization', `Bearer ${tokenFor('SUPER_AD_ORG', 'platform_admin')}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.plan.configured, false, 'data drift must be visible, since enforcement fails closed on it');
  assert.equal(res.body.usage.users.limit, null);
});
