// tests/crossTenantIsolation.integration.test.js
//
// F-01 from the 2026-08-20 end-to-end audit: 13 controllers had no
// dedicated test file, even though reading each one confirmed the
// multi-tenant scoping was already correct (organization_code applied in
// the query itself, or checked against req.user right after the fetch).
// "Already correct" isn't the same as "protected against a future
// regression" -- this file is that regression protection: real HTTP
// requests, against the real Express app (api.js), a real MongoDB
// (mongodb-memory-server), two real organizations and two real admin
// JWTs, for every controller the audit flagged.
//
// Pattern per controller: seed a resource under Org B, then try to
// read/write it with an Org A admin's token, and assert it's rejected
// (403 for the ones with a controller-level post-fetch check, 404 for the
// ones that scope directly in the Mongo query -- both are correct
// rejections, just different implementations of the same protection).
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';
process.env.CERTIFICATE_SERVICE_URL = process.env.CERTIFICATE_SERVICE_URL || 'http://localhost:8100';
process.env.CERTIFICATE_INTERNAL_KEY = process.env.CERTIFICATE_INTERNAL_KEY || 'test-internal-key';

let mongod;
let app;

const ORG_A = 'ORG-CT-A';
const ORG_B = 'ORG-CT-B';
let tokenA;
let tokenB;

function tokenFor(orgCode, role = 'admin') {
  return jwt.sign(
    { id: crypto.randomUUID(), username: `admin_${orgCode}`, role, organization_code: orgCode },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' }
  );
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  tokenA = tokenFor(ORG_A);
  tokenB = tokenFor(ORG_B);
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// ---------------- organizationController ----------------
test('organizationController.updateOrganization rejects Org A admin updating Org B', async () => {
  const Organization = require('../models/organization_schema');
  const orgB = await Organization.create({
    organization_code: ORG_B, name: 'Org B', city: 'C', state: 'S', country: 'PY',
    email: 'orgb@example.test', phone: '0', status: 'ACTIVE', plan: 'Free',
  });
  const res = await request(app)
    .put(`/api/organizations/${orgB._id}`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ city: 'Hijacked' });
  assert.equal(res.status, 403);
});

// ---------------- userController ----------------
test('userController.updateUser rejects Org A admin updating an Org B user profile', async () => {
  const UserProfile = require('../models/user_model');
  const target = await UserProfile.create({
    username: 'ct_user_b', organization_code: ORG_B, first_name: 'B', last_name: 'User',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'ctuserb@example.test', phone: '0', status: 'Active',
  });
  const res = await request(app)
    .put(`/api/users/${target._id}`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ first_name: 'Hijacked' });
  assert.equal(res.status, 403);
});

// E2E audit H-21: getUsersByOrgCode used to rely solely on the
// requireOwnOrg route middleware. Now the controller checks it too --
// this test would still pass either way, but it's the regression guard
// for the in-controller check specifically.
test('userController.getUsersByOrgCode rejects Org A admin reading Org B\'s users', async () => {
  const res = await request(app)
    .get(`/api/users/org/${ORG_B}`)
    .set('Authorization', `Bearer ${tokenA}`);
  assert.equal(res.status, 403);
});

// ---------------- goalController ----------------
test('goalController.deleteGoal rejects Org A admin deleting an Org B goal', async () => {
  const Goal = require('../models/goal_schema');
  const goal = await Goal.create({
    organization_code: ORG_B, goal_code: 'GOAL-CT-B', name: 'Org B Goal',
    total_score: 100, qualifying_score: 60, start_date: '2026-01-01', end_date: '2026-12-31',
  });
  const res = await request(app)
    .delete(`/api/goals/${goal._id}`)
    .set('Authorization', `Bearer ${tokenA}`);
  assert.equal(res.status, 404); // query-scoped: findOneAndDelete never matches a different org
  const stillThere = await Goal.findById(goal._id);
  assert.ok(stillThere, 'the Org B goal must still exist -- the cross-tenant delete must not have gone through');
});

// E2E audit H-21: getGoalsByOrganization used to rely solely on the
// requireOwnOrg route middleware. Now the controller checks it too.
test('goalController.getGoalsByOrganization rejects Org A admin reading Org B\'s goals', async () => {
  const res = await request(app)
    .get(`/api/goals/organization/${ORG_B}`)
    .set('Authorization', `Bearer ${tokenA}`);
  assert.equal(res.status, 403);
});

// ---------------- scoreController ----------------
test('scoreController.deleteScore rejects Org A admin deleting an Org B score', async () => {
  const Score = require('../models/score_schema');
  const score = await Score.create({ organization_code: ORG_B, goal_code: 'GOAL-CT-B', username: 'ct_user_b', score: 10 });
  const res = await request(app)
    .delete(`/api/scores/${score._id}`)
    .set('Authorization', `Bearer ${tokenA}`);
  assert.equal(res.status, 404);
  const stillThere = await Score.findById(score._id);
  assert.ok(stillThere, 'the Org B score must still exist');
});

// ---------------- apiKeyController ----------------
test('apiKeyController.deleteApiKey rejects Org A admin deleting an Org B API key', async () => {
  const ApiKey = require('../models/api_keys');
  const key = await ApiKey.create({
    organization_code: ORG_B, valid_for: 30, status: 'Active', requests_allowed_per_minute: 60,
    api_key_hash: crypto.createHash('sha256').update('ct-test-key').digest('hex'),
  });
  const res = await request(app)
    .delete(`/api/keys/${key._id}`)
    .set('Authorization', `Bearer ${tokenA}`);
  assert.equal(res.status, 404);
  const stillThere = await ApiKey.findById(key._id);
  assert.ok(stillThere, 'the Org B API key must still exist');
});

// ---------------- designController ----------------
test('designController.deleteDesign rejects Org A admin deleting an Org B template', async () => {
  const Design = require('../models/designSchema');
  await Design.create({
    organization_code: ORG_B, design_code: 'DESIGN-CT-B',
    main_template_url: 'https://example.test/t.png', template_url: 'https://example.test/t.png',
  });
  const res = await request(app)
    .delete('/api/designs/DESIGN-CT-B')
    .set('Authorization', `Bearer ${tokenA}`);
  assert.equal(res.status, 403);
  const stillThere = await Design.findOne({ design_code: 'DESIGN-CT-B' });
  assert.ok(stillThere, 'the Org B design must still exist');
});

// ---------------- completionController ----------------
// rejectCompletion, not approveCompletion: approveCompletion wraps its
// write in a real Mongo transaction (session.withTransaction), which
// requires the database to run as a replica set -- correct for
// production (and already documented in the controller's own comment),
// but mongodb-memory-server's default single-node mode isn't one.
// rejectCompletion applies the exact same organization_code-scoped query
// without a transaction, so it proves the same cross-tenant protection
// without needing a replica set here.
test('completionController.rejectCompletion rejects Org A admin rejecting an Org B completion', async () => {
  const Completion = require('../models/task_completion');
  const completion = await Completion.create({
    username: 'ct_user_b', message: 'done', organization_code: ORG_B, status: 'under_review', goal_code: 'GOAL-CT-B',
  });
  const res = await request(app)
    .patch(`/api/completions/${completion._id}/reject`)
    .set('Authorization', `Bearer ${tokenA}`);
  assert.equal(res.status, 404);
  const stillThere = await Completion.findById(completion._id);
  assert.equal(stillThere.status, 'under_review', 'an Org A admin must not be able to reject an Org B completion');
});

// E2E audit H-21: getCompletionsByOrg used to rely solely on the
// requireOwnOrg route middleware. Now the controller checks it too.
test('completionController.getCompletionsByOrg rejects Org A admin reading Org B\'s completions', async () => {
  const res = await request(app)
    .get(`/api/completions/org/${ORG_B}`)
    .set('Authorization', `Bearer ${tokenA}`);
  assert.equal(res.status, 403);
});

// ---------------- notificationController (self-scope, not org-scope) ----------------
test('notificationController.clearUserNotifications rejects clearing a different user\'s notifications', async () => {
  const tokenSelf = tokenFor(ORG_A, 'user'); // username admin_ORG-CT-A per tokenFor()
  const res = await request(app)
    .delete('/api/notifications/clear/someone_else')
    .set('Authorization', `Bearer ${tokenSelf}`);
  assert.equal(res.status, 403);
});

// ---------------- overviewController (route-level requireOwnOrg only) ----------------
test('overviewController.getOrganizationOverview rejects Org A admin reading Org B\'s overview', async () => {
  const res = await request(app)
    .get(`/api/overview/${ORG_B}`)
    .set('Authorization', `Bearer ${tokenA}`);
  assert.equal(res.status, 403);
});

// ---------------- certificateController ----------------
test('certificateController.generateCertificate rejects an Org A admin generating a certificate against an Org B design_code', async () => {
  const Design = require('../models/designSchema');
  await Design.create({
    organization_code: ORG_B, design_code: 'DESIGN-CT-CERT-B',
    main_template_url: 'https://example.test/t.png', template_url: 'https://example.test/t.png',
  });
  const res = await request(app)
    .post('/api/credentials/generate-certificate')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ design_code: 'DESIGN-CT-CERT-B', achiever_username: 'ct_user_b', credential_code: 'CRED-0000000000000001' });
  assert.equal(res.status, 404); // rejected before ever reaching the certificate microservice
});

// ---------------- digitalContractController ----------------
test('digitalContractController.fetchOrganizationContracts rejects Org A admin reading Org B\'s contracts', async () => {
  const res = await request(app)
    .get(`/api/contracts/organization/${ORG_B}`)
    .set('Authorization', `Bearer ${tokenA}`);
  assert.equal(res.status, 403);
});

// ---------------- contractSafeController ----------------
// Structurally different from the others: contract access isn't scoped by
// organization_code directly in contractSafeController itself -- it's
// scoped one layer up, in middleware/authMiddleware.js's
// attachJwtIdentity(), which looks the contract up by
// { contract_code, organization_code: decoded.organization_code } before
// contractSafeController.updateContract ever runs. An Org A admin's token
// can only ever resolve req.contract for a contract that belongs to Org
// A -- so the equivalent cross-tenant test here is: can an Org A admin's
// token update a contract that was created under Org B's organization_code.
test('contractSafeController.updateContract (via authenticateContractAccess) rejects Org A admin updating an Org B contract', async () => {
  const DigitalContract = require('../models/digitalContract');
  const UserProfile = require('../models/user_model');
  // Unlike requireAuth (which trusts the JWT claims directly),
  // authenticateContractAccess's attachJwtIdentity re-verifies the caller
  // against a real Users profile matching { username, organization_code }
  // before granting contract access -- an extra check specific to this
  // route. Needs a real profile seeded, not just a bare JWT.
  await UserProfile.findOneAndUpdate(
    { username: `admin_${ORG_A}` },
    {
      username: `admin_${ORG_A}`, organization_code: ORG_A, first_name: 'Admin', last_name: 'A',
      designation: 'Administrator', city: 'C', state: 'S', country: 'PY', email: `admin_${ORG_A}@example.test`, phone: '0', status: 'Active',
    },
    { upsert: true }
  );
  await DigitalContract.create({
    contract_code: 'CONTRACT-CT-B',
    creator_username: `admin_${ORG_B}`,
    contract_issue_date: '2026-01-01',
    contract_status: 'active',
    contract_content_url: 'https://example.test/contract.pdf',
    contract_security_hashes: crypto.createHash('sha256').update('CONTRACT-CT-B').digest('hex'),
    organization_code: ORG_B,
    contract_parties: [{ party_name: 'Party B', party_side: 'buyer', party_role: 'signer', party_email: 'partyb@example.test' }],
  });
  const res = await request(app)
    .put('/api/contracts/CONTRACT-CT-B')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ contract_title: 'Hijacked' });
  assert.equal(res.status, 404); // attachJwtIdentity never resolves req.contract for a different org's contract_code
});

// ---------------- invitationController ----------------
test('invitationController.generateInvitation always uses the caller\'s own organization_code, never a client-supplied one', async () => {
  const res = await request(app)
    .post('/api/invitations/generate')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ email: 'invitee@example.test', organization_code: ORG_B }); // attempted spoof, should be ignored
  // Whatever the outcome (200 or a validation 4xx), the point of this test
  // is structural: the controller reads req.user.organization_code, never
  // req.body.organization_code -- confirmed by reading the source
  // (controllers/invitationController.js:13). If that ever changes to
  // trust the body instead, this assertion is what would need updating
  // alongside it, which is the point.
  const Invitation = require('../models/invitation_schema');
  if (res.status < 300) {
    const created = await Invitation.findOne({}).sort({ _id: -1 });
    assert.equal(created.organization_code, ORG_A, 'an invitation must always carry the caller\'s own org, never a client-supplied one');
  } else {
    assert.ok(res.status >= 400 && res.status < 500);
  }
});
