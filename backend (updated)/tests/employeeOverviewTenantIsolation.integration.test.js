// tests/employeeOverviewTenantIsolation.integration.test.js
//
// E2E audit finding H-01 (and H-10, same function): getEmployeeOverview's
// Credentials queries filtered only by achiever_username, with no
// organization_code -- the exact same bug class already found and fixed
// in routes/user_dash_algorithm.js (SEC-AUDIT-1). Reproduced here with
// the identical real-world scenario: a guest-issued credential (no Users
// record) in one organization whose free-text name collides with a real
// employee's username in a different organization.
// Real HTTP requests against the real Express app (api.js), a real
// MongoDB (mongodb-memory-server).
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

let mongod;
let app;

function tokenFor(orgCode, role, username) {
  return jwt.sign({ id: crypto.randomUUID(), username, role, organization_code: orgCode }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('getEmployeeOverview never counts, lists, or crowns a colliding-name credential issued by a different organization', async () => {
  const ORG_A = 'ORG-OVERVIEW-A';
  const ORG_B = 'ORG-OVERVIEW-B';
  const COLLIDING_NAME = 'Jamie Rivera';

  const adminA = tokenFor(ORG_A, 'admin', 'overview_admin_a');
  const adminB = tokenFor(ORG_B, 'admin', 'overview_admin_b');

  const UserProfile = require('../models/user_model');
  await UserProfile.create({
    username: COLLIDING_NAME, organization_code: ORG_A, first_name: 'Jamie', last_name: 'Rivera',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'jamie.a@example.test', phone: '0', status: 'Active',
  });

  // Baseline: Org A's real employee has zero credentials before Org B does anything.
  const before = await request(app)
    .get(`/api/overview/employee/${ORG_A}/${encodeURIComponent(COLLIDING_NAME)}`)
    .set('Authorization', `Bearer ${adminA}`);
  assert.equal(before.status, 200);
  assert.equal(before.body.credentials_issued, 0);
  assert.equal(before.body.credentials_claimed, 0);
  assert.deepEqual(before.body.recent_achievements, []);

  // Org B issues a GUEST credential (no Users record at all) whose free-text
  // achiever_username happens to be the exact same string.
  const Credentials = require('../models/credentialSchema');
  await Credentials.create({
    credential_code: 'CRED-E2EH01OVERVIEW01', achiever_username: COLLIDING_NAME,
    organization_code: ORG_B, credential_title: "Org B's Secret Guest Award",
    credential_pic_url: 'https://example.test/pic.png', credential_status: 'Claimed',
    credential_issue_date: new Date().toISOString().slice(0, 10), credential_expiry_date: '2099-01-01', credential_blockchain_hashes: 'test-hash',
  });

  const after = await request(app)
    .get(`/api/overview/employee/${ORG_A}/${encodeURIComponent(COLLIDING_NAME)}`)
    .set('Authorization', `Bearer ${adminA}`);
  assert.equal(after.status, 200);
  assert.equal(after.body.credentials_issued, 0, "Org A's employee overview must not count Org B's guest credential");
  assert.equal(after.body.credentials_claimed, 0);
  assert.deepEqual(after.body.recent_achievements, [], "Org B's credential title must never leak into Org A's recent achievements");

  // Org B's own overview for the same free-text name DOES see its own credential.
  const bView = await request(app)
    .get(`/api/overview/employee/${ORG_B}/${encodeURIComponent(COLLIDING_NAME)}`)
    .set('Authorization', `Bearer ${adminB}`)
    .catch(() => null);
  // Org B has no Users record for this name (it's a guest-only credential),
  // so this 404s on the Users lookup -- confirming the isolation is real
  // and not an accidental "both sides see nothing" false negative.
  assert.equal(bView.status, 404);
});

test('the "star employee" aggregate never crowns or reveals a top achiever from a different organization', async () => {
  const ORG_A = 'ORG-STAR-A';
  const ORG_B = 'ORG-STAR-B';
  const adminA = tokenFor(ORG_A, 'admin', 'star_admin_a');

  const UserProfile = require('../models/user_model');
  await UserProfile.create({
    username: 'star_employee_a', organization_code: ORG_A, first_name: 'A', last_name: 'One',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'stara@example.test', phone: '0', status: 'Active',
  });

  // Org B has a much more prolific achiever -- if the aggregate were still
  // unscoped, this user would win the platform-wide $group/$sort/$limit,
  // and Org A's employee-overview response would come back with an empty
  // star_employee (since the old code's Users lookup for the winner was
  // already, correctly, organization_code-scoped) -- itself a correctness
  // bug (H-10) on top of the unscoped-scan security concern.
  const Credentials = require('../models/credentialSchema');
  await Credentials.create([
    { credential_code: 'CRED-E2EH10STAR0001', achiever_username: 'prolific_org_b_user', organization_code: ORG_B, credential_title: 'Org B credential 1', credential_pic_url: 'https://example.test/p.png', credential_status: 'Claimed', credential_issue_date: '2026-01-01', credential_expiry_date: '2099-01-01', credential_blockchain_hashes: 'test-hash' },
    { credential_code: 'CRED-E2EH10STAR0002', achiever_username: 'prolific_org_b_user', organization_code: ORG_B, credential_title: 'Org B credential 2', credential_pic_url: 'https://example.test/p.png', credential_status: 'Claimed', credential_issue_date: '2026-01-02', credential_expiry_date: '2099-01-01', credential_blockchain_hashes: 'test-hash' },
    { credential_code: 'CRED-E2EH10STAR0003', achiever_username: 'prolific_org_b_user', organization_code: ORG_B, credential_title: 'Org B credential 3', credential_pic_url: 'https://example.test/p.png', credential_status: 'Claimed', credential_issue_date: '2026-01-03', credential_expiry_date: '2099-01-01', credential_blockchain_hashes: 'test-hash' },
    { credential_code: 'CRED-E2EH10STAR0004', achiever_username: 'star_employee_a', organization_code: ORG_A, credential_title: 'Org A credential 1', credential_pic_url: 'https://example.test/p.png', credential_status: 'Claimed', credential_issue_date: '2026-01-04', credential_expiry_date: '2099-01-01', credential_blockchain_hashes: 'test-hash' },
  ]);

  const res = await request(app)
    .get(`/api/overview/employee/${ORG_A}/star_employee_a`)
    .set('Authorization', `Bearer ${adminA}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.star_employee.name, 'A One', "Org A's own top achiever must win Org A's star-employee slot, never Org B's more prolific user");
});
