// tests/dashboardConsolidation.integration.test.js
//
// E2E audit H-23: overviewController.js, routes/organization_dashboard.js,
// and routes/user_dash_algorithm.js each reimplemented the same
// organization-scoped credential/score computations independently, via
// services/dashboardMetricsService.js now. Two things are worth guarding
// against regressing:
//
// 1. routes/organization_dashboard.js used to scope its credential
//    numbers by `achiever_username: { $in: <org's usernames> }` instead
//    of `organization_code` directly -- the same unsafe name-based org
//    matching already fixed elsewhere as H-01/H-10/SEC-AUDIT-1. This was
//    a genuine, previously-unfixed cross-tenant leak found while
//    consolidating the three dashboards onto the shared, safe service.
// 2. routes/user_dash_algorithm.js's ranking used to include every org
//    member (even those with zero completions) when computing
//    `my_ranking`; the new shared getScoreRanking() must be told to do
//    the same via `includeUsernames`, or a brand-new employee's rank
//    silently changes.
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
let Organization;
let Users;
let Credentials;
let Score;

function tokenFor(orgCode, username, role = 'admin') {
  return jwt.sign({ id: crypto.randomUUID(), username, role, organization_code: orgCode }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  Organization = require('../models/organization_schema');
  Users = require('../models/user_model');
  Credentials = require('../models/credentialSchema');
  Score = require('../models/score_schema');
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('organization_dashboard.js (H-23) never counts a colliding-name credential from a different organization', async () => {
  const ORG_A = 'ORG-DASH-A';
  const ORG_B = 'ORG-DASH-B';
  const COLLIDING_NAME = 'dash_collision_user';
  const adminA = tokenFor(ORG_A, 'dash_admin_a');

  await Organization.create({
    organization_code: ORG_A, name: 'Dash Org A', city: 'C', state: 'S', country: 'PY',
    email: 'dasha@example.test', phone: '0', status: 'ACTIVE', plan: 'Free',
  });
  await Users.create({
    username: COLLIDING_NAME, organization_code: ORG_A, first_name: 'Dash', last_name: 'A',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'dasha_user@example.test', phone: '0', status: 'Active',
  });

  const before = await request(app).get(`/api/organization_performance/${ORG_A}`).set('Authorization', `Bearer ${adminA}`);
  assert.equal(before.status, 200);
  assert.equal(before.body.total_credentials_issued, 0);

  // Org B issues 3 guest credentials to a free-text name that collides
  // with Org A's real user.
  await Credentials.create([
    { credential_code: 'CRED-DASH-B-001', achiever_username: COLLIDING_NAME, organization_code: ORG_B, credential_title: 'Org B 1', credential_pic_url: 'https://example.test/p.png', credential_status: 'Claimed', credential_issue_date: '2026-01-01', credential_expiry_date: '2099-01-01', credential_blockchain_hashes: 'h1' },
    { credential_code: 'CRED-DASH-B-002', achiever_username: COLLIDING_NAME, organization_code: ORG_B, credential_title: 'Org B 2', credential_pic_url: 'https://example.test/p.png', credential_status: 'Claimed', credential_issue_date: '2026-01-02', credential_expiry_date: '2099-01-01', credential_blockchain_hashes: 'h2' },
    { credential_code: 'CRED-DASH-B-003', achiever_username: COLLIDING_NAME, organization_code: ORG_B, credential_title: 'Org B 3', credential_pic_url: 'https://example.test/p.png', credential_status: 'Claimed', credential_issue_date: '2026-01-03', credential_expiry_date: '2099-01-01', credential_blockchain_hashes: 'h3' },
  ]);

  const after = await request(app).get(`/api/organization_performance/${ORG_A}`).set('Authorization', `Bearer ${adminA}`);
  assert.equal(after.status, 200);
  assert.equal(after.body.total_credentials_issued, 0, "Org A's analytics must not count Org B's colliding-name credentials");
  assert.deepEqual(after.body.organization_growth, [], "Org B's issuance must not show up in Org A's growth chart");

  // Org A issues its own real credential to the same user -- that one
  // (and only that one) must be counted.
  await Credentials.create({
    credential_code: 'CRED-DASH-A-001', achiever_username: COLLIDING_NAME, organization_code: ORG_A, credential_title: 'Org A real', credential_pic_url: 'https://example.test/p.png', credential_status: 'Claimed', credential_issue_date: '2026-01-04', credential_expiry_date: '2099-01-01', credential_blockchain_hashes: 'h4',
  });
  const finalRes = await request(app).get(`/api/organization_performance/${ORG_A}`).set('Authorization', `Bearer ${adminA}`);
  assert.equal(finalRes.body.total_credentials_issued, 1);
});

test('organization_dashboard.js (H-23) top/least performer credential counts are organization-scoped', async () => {
  const ORG_A = 'ORG-DASH-PERF-A';
  const ORG_B = 'ORG-DASH-PERF-B';
  const adminA = tokenFor(ORG_A, 'dash_perf_admin_a');

  await Organization.create({
    organization_code: ORG_A, name: 'Dash Perf Org A', city: 'C', state: 'S', country: 'PY',
    email: 'dashperfa@example.test', phone: '0', status: 'ACTIVE', plan: 'Free',
  });
  await Score.create({ organization_code: ORG_A, goal_code: 'GOAL-DASH-A', username: 'top_scorer_a', score: 50 });

  // Same username, unrelated organization, with a pile of credentials --
  // must never bleed into Org A's topPerformerCreds count.
  await Credentials.create([
    { credential_code: 'CRED-DASHPERF-B-001', achiever_username: 'top_scorer_a', organization_code: ORG_B, credential_title: 'Org B 1', credential_pic_url: 'https://example.test/p.png', credential_status: 'Claimed', credential_issue_date: '2026-01-01', credential_expiry_date: '2099-01-01', credential_blockchain_hashes: 'hb1' },
    { credential_code: 'CRED-DASHPERF-B-002', achiever_username: 'top_scorer_a', organization_code: ORG_B, credential_title: 'Org B 2', credential_pic_url: 'https://example.test/p.png', credential_status: 'Claimed', credential_issue_date: '2026-01-02', credential_expiry_date: '2099-01-01', credential_blockchain_hashes: 'hb2' },
  ]);
  await Credentials.create({
    credential_code: 'CRED-DASHPERF-A-001', achiever_username: 'top_scorer_a', organization_code: ORG_A, credential_title: 'Org A 1', credential_pic_url: 'https://example.test/p.png', credential_status: 'Claimed', credential_issue_date: '2026-01-03', credential_expiry_date: '2099-01-01', credential_blockchain_hashes: 'ha1',
  });

  const res = await request(app).get(`/api/organization_performance/${ORG_A}`).set('Authorization', `Bearer ${adminA}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.top_performing_employee.username, 'top_scorer_a');
  assert.equal(res.body.top_performing_employee.issued_credentials, 1, "must count only Org A's own credential for this user, not Org B's");
});

test('user_dash_algorithm.js (H-23) my_ranking still ranks a zero-score org member last, not "unranked"', async () => {
  const ORG = 'ORG-DASH-RANK';
  const scoredAdmin = tokenFor(ORG, 'ranked_user');
  const zeroAdmin = tokenFor(ORG, 'zero_score_user');

  await Organization.create({
    organization_code: ORG, name: 'Rank Org', city: 'C', state: 'S', country: 'PY',
    email: 'rankorg@example.test', phone: '0', status: 'ACTIVE', plan: 'Free',
  });
  await Users.create([
    { username: 'ranked_user', organization_code: ORG, first_name: 'Ranked', last_name: 'User', designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'ranked@example.test', phone: '0', status: 'Active' },
    { username: 'zero_score_user', organization_code: ORG, first_name: 'Zero', last_name: 'Score', designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'zero@example.test', phone: '0', status: 'Active' },
  ]);
  await Score.create({ organization_code: ORG, goal_code: 'GOAL-RANK', username: 'ranked_user', score: 20 });

  const rankedRes = await request(app).get('/api/performance/ranked_user').set('Authorization', `Bearer ${scoredAdmin}`);
  assert.equal(rankedRes.status, 200);
  assert.equal(rankedRes.body.metrics.my_ranking, 1);

  const zeroRes = await request(app).get('/api/performance/zero_score_user').set('Authorization', `Bearer ${zeroAdmin}`);
  assert.equal(zeroRes.status, 200);
  assert.equal(zeroRes.body.metrics.my_ranking, 2, 'a user with zero completions must still get a real, last-place rank, not 0/unranked');
});
