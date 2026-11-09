// tests/performanceDashboardTenantIsolation.integration.test.js
//
// SEC-AUDIT-1 (deep technical & security audit): GET /api/performance/:username
// (routes/user_dash_algorithm.js) scoped its initial Users.findOne lookup by
// organization_code (a fix from an earlier audit round), but the 7
// Credentials/Score queries after that lookup still filtered only by
// achiever_username/username, with no organization_code. Harmless for a real
// registered recipient (Users.username has a real unique index, confirmed in
// models/user_model.js), but not for a guest-issued credential, whose
// achiever_username is free text (see credentialController.createCredential)
// checked for a name collision only against the ISSUING organization's own
// real users -- never against other organizations. Reproduced for real
// against the actual running docker-compose stack before this fix existed:
// organization A had a real user "audit_collision_user"; organization B
// issued a guest credential to a recipient also named "audit_collision_user";
// organization A's own admin, viewing that real user's dashboard, saw
// organization B's credential mixed into their achievements, monthly
// progress, and credential-type charts. This test reproduces the same
// scenario against the real Express app + a real MongoDB
// (mongodb-memory-server), so this exact class of leak can never silently
// come back.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { stubEmailTransport } = require('./testHelpers/stubEmailTransport');
let emailStub;

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';
process.env.CERTIFICATE_SERVICE_URL = process.env.CERTIFICATE_SERVICE_URL || 'http://localhost:8100';
process.env.CERTIFICATE_INTERNAL_KEY = process.env.CERTIFICATE_INTERNAL_KEY || 'test-internal-key';

let mongod;
let app;

const ORG_A = 'ORG-TENANT-ISO-A';
const ORG_B = 'ORG-TENANT-ISO-B';
const COLLIDING_USERNAME = 'tenant_iso_collision_user';
let adminA;
let adminB;

function tokenFor(orgCode, username) {
  return jwt.sign({ id: crypto.randomUUID(), username, role: 'admin', organization_code: orgCode }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

test.before(async () => {
  emailStub = stubEmailTransport();
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  adminA = tokenFor(ORG_A, 'tenant_iso_admin_a');
  adminB = tokenFor(ORG_B, 'tenant_iso_admin_b');

  const Organization = require('../models/organization_schema');
  const Plan = require('../models/plan_schema');
  const Users = require('../models/user_model');
  await Organization.create([
    { organization_code: ORG_A, name: 'Tenant Isolation Org A', city: 'C', state: 'S', country: 'PY', email: 'tenant-iso-a@example.test', phone: '0', status: 'ACTIVE', plan: 'Free' },
    { organization_code: ORG_B, name: 'Tenant Isolation Org B', city: 'C', state: 'S', country: 'PY', email: 'tenant-iso-b@example.test', phone: '0', status: 'ACTIVE', plan: 'Free' },
  ]);
  await Plan.findOneAndUpdate({ name: 'Free' }, { name: 'Free', max_users: 5, max_credentials_per_month: 25, max_api_calls_per_month: 500 }, { upsert: true });

  // The real user that will be attacked -- belongs only to Org A.
  await Users.create({
    username: COLLIDING_USERNAME, organization_code: ORG_A, first_name: 'Collision', last_name: 'User',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'tenant-iso-collision@example.test', phone: '0', status: 'Active',
  });
});

test.after(async () => {
  emailStub.restore();
  await mongoose.disconnect();
  await mongod.stop();
});

test('baseline: the real user in Org A has zero credentials before Org B issues anything', async () => {
  const res = await request(app).get(`/api/performance/${COLLIDING_USERNAME}`).set('Authorization', `Bearer ${adminA}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.metrics.credentials_this_month, 0);
  assert.equal(res.body.achievements.length, 0);
});

test("Org B issues a real guest credential whose achiever_username collides with Org A's real user", async () => {
  const credCodeRes = await request(app).post('/api/credentials/reserve-code').set('Authorization', `Bearer ${adminB}`);
  assert.equal(credCodeRes.status, 200);
  const { credential_code } = credCodeRes.body;

  const createRes = await request(app)
    .post('/api/credentials/create')
    .set('Authorization', `Bearer ${adminB}`)
    .send({
      credential_pic_url: `${process.env.PUBLIC_STORAGE_BASE_URL}/uploads/tenant-iso-test.png`,
      achiever_username: COLLIDING_USERNAME,
      credential_code,
      credential_title: 'Org B Course',
      guest_recipient: { first_name: 'Someone', last_name: 'FromOrgB', email: 'someone-orgb@example.test' },
    });
  assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
  assert.equal(createRes.body.organization_detail.code, ORG_B);
});

test("SEC-AUDIT-1 fix: Org A's dashboard for its own real user does NOT show Org B's guest credential", async () => {
  const res = await request(app).get(`/api/performance/${COLLIDING_USERNAME}`).set('Authorization', `Bearer ${adminA}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.metrics.credentials_this_month, 0, 'Org B credential must not count toward Org A user\'s monthly total');
  assert.equal(res.body.achievements.length, 0, 'Org B credential must not appear in Org A user\'s achievements');
  assert.deepEqual(res.body.charts.monthly_progress, []);
  assert.deepEqual(res.body.charts.credential_types, []);
});

test("Org B's own credential is still real and queryable through Org B's own normal credential list (the fix did not break same-org access)", async () => {
  const res = await request(app).get(`/api/credentials/by-organization/${ORG_B}`).set('Authorization', `Bearer ${adminB}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.pagination.total_items, 1);
  assert.equal(res.body.data[0].achiever_username, COLLIDING_USERNAME);
  assert.equal(res.body.data[0].organization_code, ORG_B);
});
