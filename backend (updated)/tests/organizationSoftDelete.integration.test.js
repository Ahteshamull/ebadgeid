// tests/organizationSoftDelete.integration.test.js
//
// E2E audit H-22: deleteOrganization used to be a hard Mongo delete with
// no cascade -- every credential, user, design, contract, etc. under the
// organization became silently orphaned, and the delete was
// unrecoverable. This is now a soft delete (status: 'DELETED' +
// deleted_at), and this file proves: the org and everything under it
// survives the delete, a deleted org can no longer be used to log in or
// looked up publicly, it's excluded from the default admin listing but
// still reachable for audit, and deleting twice is a clean 409 rather
// than a silent no-op.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';
process.env.CERTIFICATE_SERVICE_URL = process.env.CERTIFICATE_SERVICE_URL || 'http://localhost:8100';
process.env.CERTIFICATE_INTERNAL_KEY = process.env.CERTIFICATE_INTERNAL_KEY || 'test-internal-key';

let mongod;
let app;
let Organization;
let Users;
let Auth;

function platformAdminToken() {
  return jwt.sign(
    { id: crypto.randomUUID(), username: 'platform_admin_sd', role: 'platform_admin', organization_code: 'ORG-SD-PLATFORM' },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' }
  );
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  Organization = require('../models/organization_schema');
  Users = require('../models/user_model');
  Auth = require('../models/AuthCredentials');
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('deleteOrganization soft-deletes: org and its data survive, status/deleted_at are set', async () => {
  const org = await Organization.create({
    organization_code: 'ORG-SD-01', name: 'Soft Delete Co', city: 'C', state: 'S', country: 'PY',
    email: 'sd01@example.test', phone: '0', status: 'ACTIVE', plan: 'Free',
  });
  const user = await Users.create({
    username: 'sd01_user', organization_code: 'ORG-SD-01', first_name: 'A', last_name: 'B',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'sd01user@example.test', phone: '0', status: 'Active',
  });

  const res = await request(app)
    .delete(`/api/organizations/${org._id}`)
    .set('Authorization', `Bearer ${platformAdminToken()}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.deleted_at);

  const reloaded = await Organization.findById(org._id);
  assert.equal(reloaded.status, 'DELETED');
  assert.ok(reloaded.deleted_at instanceof Date);

  const stillThere = await Users.findById(user._id);
  assert.ok(stillThere, 'the organization\'s user profile must not be cascade-deleted -- soft delete only');
});

test('deleteOrganization on an already-deleted organization returns 409, not a silent no-op', async () => {
  const org = await Organization.create({
    organization_code: 'ORG-SD-02', name: 'Twice Deleted Co', city: 'C', state: 'S', country: 'PY',
    email: 'sd02@example.test', phone: '0', status: 'DELETED', plan: 'Free', deleted_at: new Date(),
  });
  const res = await request(app)
    .delete(`/api/organizations/${org._id}`)
    .set('Authorization', `Bearer ${platformAdminToken()}`);
  assert.equal(res.status, 409);
});

test('getAllOrganizations excludes soft-deleted orgs by default, includes them with include_deleted=true', async () => {
  await Organization.create({
    organization_code: 'ORG-SD-03', name: 'Listed Co', city: 'C', state: 'S', country: 'PY',
    email: 'sd03@example.test', phone: '0', status: 'ACTIVE', plan: 'Free',
  });
  await Organization.create({
    organization_code: 'ORG-SD-04', name: 'Hidden Deleted Co', city: 'C', state: 'S', country: 'PY',
    email: 'sd04@example.test', phone: '0', status: 'DELETED', plan: 'Free', deleted_at: new Date(),
  });
  const token = platformAdminToken();

  const defaultRes = await request(app).get('/api/organizations').set('Authorization', `Bearer ${token}`);
  assert.equal(defaultRes.status, 200);
  assert.ok(!defaultRes.body.some(o => o.organization_code === 'ORG-SD-04'), 'a soft-deleted org must not appear in the default listing');

  const includeRes = await request(app).get('/api/organizations?include_deleted=true').set('Authorization', `Bearer ${token}`);
  assert.equal(includeRes.status, 200);
  assert.ok(includeRes.body.some(o => o.organization_code === 'ORG-SD-04'), 'a platform admin must still be able to pull up a soft-deleted org for audit');
});

test('getOrganizationByOrgCode (public) returns 404 for a soft-deleted organization', async () => {
  await Organization.create({
    organization_code: 'ORG-SD-05', name: 'Public Gone Co', city: 'C', state: 'S', country: 'PY',
    email: 'sd05@example.test', phone: '0', status: 'DELETED', plan: 'Free', deleted_at: new Date(),
  });
  const res = await request(app).get('/api/organizations/code/ORG-SD-05');
  assert.equal(res.status, 404);
});

test('login is rejected for a user whose organization was soft-deleted, even with the correct password', async () => {
  await Organization.create({
    organization_code: 'ORG-SD-06', name: 'Login Gone Co', city: 'C', state: 'S', country: 'PY',
    email: 'sd06@example.test', phone: '0', status: 'ACTIVE', plan: 'Free',
  });
  await Users.create({
    username: 'sd06_user', organization_code: 'ORG-SD-06', first_name: 'A', last_name: 'B',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'sd06user@example.test', phone: '0', status: 'Active',
  });
  await Auth.create({
    username: 'sd06_user', password: await bcrypt.hash('a-real-password-123', 12), user_role: 'user',
  });

  const before = await request(app).post('/api/auth/login').send({ username: 'sd06_user', password: 'a-real-password-123' });
  assert.equal(before.status, 200, 'sanity check: login works before the org is deleted');

  await Organization.updateOne({ organization_code: 'ORG-SD-06' }, { status: 'DELETED', deleted_at: new Date() });

  const after = await request(app).post('/api/auth/login').send({ username: 'sd06_user', password: 'a-real-password-123' });
  assert.equal(after.status, 400);
});
