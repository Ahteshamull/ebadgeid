// tests/seatLimitConcurrency.integration.test.js
//
// HIGH-02 (audit finding, confirmed real by code review before this fix):
// middleware/enforcePlanLimits.js's wouldExceedUserLimit counted Users
// documents, then controllers/userController.js's self_signup_user
// separately inserted a new one -- not a reservation. Two invitations
// accepted at the same moment could both read the same under-the-limit
// count inside their own transaction before either committed, since they
// insert different new User/Auth documents with no natural write conflict
// between them, so BOTH could pass a check meant to allow only one more
// seat. This proves the fix (organization_schema.js's seat_count field,
// reserved atomically via findOneAndUpdate + $lt) against the actual race
// it was written for -- real concurrent HTTP requests, real MongoDB
// transactions, a real replica set (required for transactions at all; see
// tests/selfServiceSignup.integration.test.js's header comment for the
// same requirement elsewhere in this suite).
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'test_encryption_secret_at_least_32_chars_long';

let replSet;
let app;

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  ({ app } = require('../api.js'));
});

test.after(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

// Plan.name and Organization.plan are both enum-restricted to the 4 real
// plan names -- can't create a custom-named plan per test. Each test below
// passes its own distinct planName (one of the 4 real names) and just
// overwrites that plan's max_users for this test's purposes; every test
// uses its own Organization (distinct organization_code either way), so
// reusing a real plan name with a throwaway max_users, scoped to this
// file's own isolated replica set, doesn't affect anything else.
async function makeOrgAtSeatLimit(orgCode, planName, { maxUsers, existingUsers }) {
  const Organization = require('../models/organization_schema');
  const Plan = require('../models/plan_schema');
  const Users = require('../models/user_model');
  const Auth = require('../models/AuthCredentials');
  const bcrypt = require('bcryptjs');

  await Plan.findOneAndUpdate(
    { name: planName },
    { name: planName, max_users: maxUsers, max_credentials_per_month: 100, max_api_calls_per_month: 1000, is_free: false },
    { upsert: true }
  );
  await Organization.create({
    organization_code: orgCode, name: `Seat Test Org ${orgCode}`, city: 'C', state: 'S', country: 'PY',
    email: `${orgCode.toLowerCase()}@example.test`, phone: '0', status: 'ACTIVE', plan: planName, seat_count: existingUsers,
  });
  for (let i = 0; i < existingUsers; i++) {
    const username = `${orgCode.toLowerCase()}_existing_${i}`;
    await Auth.create({ username, password: await bcrypt.hash('ExistingUser123!', 10), user_role: 'user' });
    await Users.create({
      username, organization_code: orgCode, first_name: 'E', last_name: `U${i}`, designation: 'Staff',
      city: 'C', state: 'S', country: 'PY', phone: '0', email: `${username}@example.test`, status: 'Active',
    });
  }
}

async function makeInviteCode(email, orgCode) {
  const encryptionService = require('../utils/cryptoHelper');
  const Invitation = require('../models/invitation_schema');
  const code = encryptionService.encrypt(`${email}:${orgCode}:123456`);
  await Invitation.create({ invitation_code: code, organization_code: orgCode, status: 'Active' });
  return code;
}

function signupBody(username) {
  return {
    username, password: 'BrandNewUser123!', confirmPassword: 'BrandNewUser123!',
    first_name: 'New', last_name: 'User', designation: 'Staff', city: 'C', state: 'S', country: 'PY', phone: '0',
  };
}

test('two invitations accepted at the exact same time for the LAST open seat: exactly one succeeds, the other is rejected with 402', async () => {
  const ORG = 'ORG-SEAT-RACE';
  // 1 existing real user, max_users: 2 -- exactly one seat left. Two
  // concurrent acceptances both racing for that same one seat.
  await makeOrgAtSeatLimit(ORG, 'Basic', { maxUsers: 2, existingUsers: 1 });
  const codeA = await makeInviteCode('racer.a@example.test', ORG);
  const codeB = await makeInviteCode('racer.b@example.test', ORG);

  const [resA, resB] = await Promise.all([
    request(app).post('/api/users/self-signup').set('x-invite-code', codeA).send(signupBody('seat_race_user_a')),
    request(app).post('/api/users/self-signup').set('x-invite-code', codeB).send(signupBody('seat_race_user_b')),
  ]);

  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [201, 402], `expected exactly one 201 (accepted) and one 402 (seat limit reached), got ${resA.status} and ${resB.status}`);

  const Users = require('../models/user_model');
  const finalCount = await Users.countDocuments({ organization_code: ORG });
  assert.equal(finalCount, 2, 'the organization must end with exactly max_users (2) real users, never 3');

  const Organization = require('../models/organization_schema');
  const org = await Organization.findOne({ organization_code: ORG });
  assert.equal(org.seat_count, finalCount, 'seat_count must exactly match the real Users count after the race resolves');
});

test('a rejected signup due to the seat limit does not create an Auth/User document, and the invitation is not consumed', async () => {
  const ORG = 'ORG-SEAT-REJECT';
  await makeOrgAtSeatLimit(ORG, 'Premium', { maxUsers: 1, existingUsers: 1 }); // already full
  const code = await makeInviteCode('rejected.user@example.test', ORG);

  const res = await request(app).post('/api/users/self-signup').set('x-invite-code', code).send(signupBody('seat_reject_user'));
  assert.equal(res.status, 402);
  assert.match(res.body.message, /limit reached/i);

  const AuthCredentials = require('../models/AuthCredentials');
  assert.equal(await AuthCredentials.findOne({ username: 'seat_reject_user' }), null, 'no Auth document may be created for a rejected signup');
  const Users = require('../models/user_model');
  assert.equal(await Users.findOne({ username: 'seat_reject_user' }), null, 'no User profile may be created for a rejected signup');

  const Invitation = require('../models/invitation_schema');
  const invitation = await Invitation.findOne({ invitation_code: code });
  assert.equal(invitation.status, 'Active', 'a rejected signup must not consume the invitation -- the whole transaction, including the seat reservation, rolled back');
});

test('deleting a user decrements seat_count so a later, real open seat is not falsely blocked', async () => {
  const ORG = 'ORG-SEAT-DELETE';
  await makeOrgAtSeatLimit(ORG, 'Basic', { maxUsers: 2, existingUsers: 2 }); // full

  const Users = require('../models/user_model');
  const toDelete = await Users.findOne({ organization_code: ORG });

  const jwt = require('jsonwebtoken');
  const adminToken = jwt.sign({ id: 'admin1', username: 'seat_delete_admin', role: 'admin', organization_code: ORG }, process.env.JWT_SECRET, { algorithm: 'HS256' });

  const deleteRes = await request(app).delete(`/api/users/${toDelete._id}`).set('Authorization', `Bearer ${adminToken}`);
  assert.equal(deleteRes.status, 200);

  const Organization = require('../models/organization_schema');
  const org = await Organization.findOne({ organization_code: ORG });
  assert.equal(org.seat_count, 1, 'seat_count must decrement when a user is deleted');

  const code = await makeInviteCode('after.delete@example.test', ORG);
  const res = await request(app).post('/api/users/self-signup').set('x-invite-code', code).send(signupBody('seat_after_delete_user'));
  assert.equal(res.status, 201, `the freed seat must be usable by a new signup, got ${res.status}: ${JSON.stringify(res.body)}`);
});
