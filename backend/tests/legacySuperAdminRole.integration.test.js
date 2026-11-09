// tests/legacySuperAdminRole.integration.test.js
//
// The real production database holds one account whose user_role is
// 'super_admin' -- a legacy spelling predating this codebase's own
// 'platform_admin' top tier (verified live against production: 1 of 10
// accounts, and it is the operator's own). Deploying this codebase over
// that database used to fail two different ways:
//
//   1. The schema enum did not list the value, so Mongoose rejected the
//      document on any full-document validation. That is exactly how the
//      deployed system's password reset broke: .save() re-validated the
//      whole user and threw on a field the reset never touched, so that
//      account could not reset its password at all (confirmed in the
//      production logs, HTTP 500).
//   2. Even with the value accepted, ~11 places compare req.user.role to
//      'platform_admin' directly. The account would authenticate and then
//      be silently treated as an ordinary org-scoped admin -- no
//      cross-tenant listing, no org status changes -- which is worse than
//      an outright rejection because it fails quietly.
//
// Both are closed by normalizing the role once, where the session is
// built (middleware/requireAuth.js). These tests pin that behaviour so a
// future change cannot reintroduce either failure.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only_min_32';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';

let mongod;
let app;
let AuthCred;
let UserProfile;
let Organization;

const tokenFor = (role) => jwt.sign(
  { id: crypto.randomUUID(), username: 'legacy_super@ebadgeid.test', role, organization_code: 'SUPER_AD_ORG' },
  process.env.JWT_SECRET,
  { algorithm: 'HS256' },
);

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  AuthCred = require('../models/AuthCredentials');
  UserProfile = require('../models/user_model');
  Organization = require('../models/organization_schema');

  await Organization.create({
    organization_code: 'SUPER_AD_ORG', name: 'Platform', city: 'C', state: 'S', country: 'CR',
    email: 'platform@ebadgeid.test', phone: '0', status: 'ACTIVE', plan: 'Free',
  });
  await Organization.create({
    organization_code: 'TENANT-A', name: 'Tenant A', city: 'C', state: 'S', country: 'CR',
    email: 'a@ebadgeid.test', phone: '0', status: 'ACTIVE', plan: 'Free',
  });
});

test.after(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test('an account carrying the legacy super_admin role can be stored at all', async () => {
  // This is the write that used to throw and produce the production 500.
  const created = await AuthCred.create({
    username: 'legacy_super@ebadgeid.test',
    password: await bcrypt.hash('LegacySuperPassword123!', 12),
    user_role: 'super_admin',
  });
  assert.equal(created.user_role, 'super_admin');

  await UserProfile.create({
    username: 'legacy_super@ebadgeid.test', organization_code: 'SUPER_AD_ORG',
    first_name: 'Legacy', last_name: 'Super', designation: 'Platform Admin',
    city: 'C', state: 'S', country: 'CR', email: 'legacy_super@ebadgeid.test',
    phone: '0', status: 'active',
  });

  // A full-document save must also survive -- that is the operation
  // password reset performs, and the one that failed in production.
  const reloaded = await AuthCred.findOne({ username: 'legacy_super@ebadgeid.test' }).select('+password');
  reloaded.password = await bcrypt.hash('AnotherPassword456!', 12);
  await assert.doesNotReject(() => reloaded.save(), 'a full save must not throw on the legacy role');
});

test('the legacy role is granted the same platform-admin access as the canonical one', async () => {
  // GET /organizations is requireAdmin-gated and returns EVERY organization
  // for a platform admin, but only the caller's own for a normal admin --
  // so this asserts real authorization behaviour, not just a 200.
  const legacy = await request(app).get('/api/organizations').set('Authorization', `Bearer ${tokenFor('super_admin')}`);
  const canonical = await request(app).get('/api/organizations').set('Authorization', `Bearer ${tokenFor('platform_admin')}`);

  assert.equal(legacy.status, 200, 'the legacy role must not be locked out');
  assert.equal(canonical.status, 200);

  const legacyCodes = (legacy.body.organizations || legacy.body || []).map(o => o.organization_code).sort();
  const canonicalCodes = (canonical.body.organizations || canonical.body || []).map(o => o.organization_code).sort();
  assert.deepEqual(legacyCodes, canonicalCodes,
    'the legacy role must see exactly what the canonical platform admin sees, not a narrowed org-scoped view');
  assert.ok(legacyCodes.includes('TENANT-A'),
    'a platform admin must see organizations beyond its own -- a silently org-scoped result is the quiet failure this guards');
});

test('a platform-admin-only route accepts the legacy role', async () => {
  const res = await request(app)
    .get('/api/organizations/summary/overview')
    .set('Authorization', `Bearer ${tokenFor('super_admin')}`);
  assert.equal(res.status, 200, 'requirePlatformAdmin must accept the legacy spelling');
});

test('normalizing the legacy role does not promote any other role', async () => {
  for (const role of ['user', 'teacher', 'admin']) {
    const res = await request(app)
      .get('/api/organizations/summary/overview')
      .set('Authorization', `Bearer ${tokenFor(role)}`);
    assert.equal(res.status, 403, `role ${role} must still be refused platform-admin access`);
  }
});
