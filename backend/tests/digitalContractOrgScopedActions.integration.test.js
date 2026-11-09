// tests/digitalContractOrgScopedActions.integration.test.js
//
// E2E audit finding H-12: inviteUserToContract, generateAccessToken, and
// removeUser used to re-fetch the contract themselves via a raw, org-
// unscoped DigitalContract.findOne({contract_code}), instead of reusing
// req.contract (already organization-scoped and permission-checked by
// authenticateToken's attachJwtIdentity). Not exploitable before this fix
// either, since attachJwtIdentity already 404s a cross-org contract_code
// before any controller runs -- but that safety depended entirely on
// every one of these three functions never being reused behind a
// different/missing middleware chain. This is real, previously-missing
// coverage for all three (H-12's "F. Tests faltantes" gap), not just a
// code-reading exercise.
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

async function makeContract(orgCode, creatorUsername, creatorEmail) {
  const DigitalContract = require('../models/digitalContract');
  const code = `CONTRACT-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  await DigitalContract.create({
    contract_code: code,
    contract_issue_date: new Date().toISOString().slice(0, 10),
    contract_status: 'active',
    contract_content_url: 'https://example.test/uploads/contract.pdf',
    contract_parties: [
      { party_name: 'Creator', party_side: 'issuer', party_role: 'admin', party_email: creatorEmail, contract_permissions: { view: true, write: true, update: true, add_discussion: true, add_timeline_event: true } },
    ],
    contract_security_hashes: 'test-hash',
    organization_code: orgCode,
    creator_username: creatorUsername,
    creator_details: { email: creatorEmail },
  });
  return code;
}

test('an admin from a DIFFERENT organization gets 404 on invite/generate-token/remove for a contract that is not theirs', async () => {
  const ORG_A = 'ORG-CONTRACT-ACTIONS-A';
  const ORG_B = 'ORG-CONTRACT-ACTIONS-B';
  const creatorEmail = 'creator@example.test';

  const UserProfile = require('../models/user_model');
  await UserProfile.create({ username: 'contract_creator', organization_code: ORG_A, first_name: 'C', last_name: 'One', designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: creatorEmail, phone: '0', status: 'Active' });
  await UserProfile.create({ username: 'other_org_admin', organization_code: ORG_B, first_name: 'O', last_name: 'One', designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'other@example.test', phone: '0', status: 'Active' });

  const contractCode = await makeContract(ORG_A, 'contract_creator', creatorEmail);
  const outsiderToken = tokenFor(ORG_B, 'admin', 'other_org_admin');

  const inviteRes = await request(app).post(`/api/contracts/${contractCode}/invite`).set('Authorization', `Bearer ${outsiderToken}`).send({ party_name: 'X', party_side: 'buyer', party_role: 'viewer', party_email: 'x@example.test' });
  assert.equal(inviteRes.status, 404);

  const tokenRes = await request(app).post(`/api/contracts/${contractCode}/generate-token`).set('Authorization', `Bearer ${outsiderToken}`).send({ email: creatorEmail, permissions: { view: true }, expires_in_days: 7 });
  assert.equal(tokenRes.status, 404);

  const removeRes = await request(app).delete(`/api/contracts/${contractCode}/remove/${encodeURIComponent('x@example.test')}`).set('Authorization', `Bearer ${outsiderToken}`);
  assert.equal(removeRes.status, 404);

  const DigitalContract = require('../models/digitalContract');
  const stillIntact = await DigitalContract.findOne({ contract_code: contractCode }).lean();
  assert.equal(stillIntact.contract_parties.length, 1, "the outsider's requests must never have modified the contract's parties");
});

test('the real owner can generate an access token for their own contract (same-org success path still works after the req.contract change)', async () => {
  const ORG = 'ORG-CONTRACT-ACTIONS-OWNER';
  const creatorEmail = 'owner_creator@example.test';
  const UserProfile = require('../models/user_model');
  await UserProfile.create({ username: 'owner_creator', organization_code: ORG, first_name: 'O', last_name: 'One', designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: creatorEmail, phone: '0', status: 'Active' });

  const contractCode = await makeContract(ORG, 'owner_creator', creatorEmail);
  const ownerToken = tokenFor(ORG, 'admin', 'owner_creator');

  const res = await request(app)
    .post(`/api/contracts/${contractCode}/generate-token`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ email: creatorEmail, permissions: { view: true }, expires_in_days: 7 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.access_token, 'a real token must be returned to the legitimate owner');
});
