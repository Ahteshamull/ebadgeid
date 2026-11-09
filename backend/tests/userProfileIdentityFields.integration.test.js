// tests/userProfileIdentityFields.integration.test.js
//
// MED-03 (audit finding, confirmed real by code review before this fix):
// controllers/userController.js's updateUser used a denylist (everything
// except organization_code, and status for non-admins), which still let
// username and email through PUT /api/users/:id. Users (this collection)
// and AuthCredentials (a separate collection, joined ONLY by the username
// string) both need to agree on username for login to keep working --
// authController.js's login looks up AuthCredentials by username, then
// re-looks-up Users by that SAME username for organization_code/profile.
// Changing just Users.username here would silently break that account's
// own next login with no recovery path short of an admin fixing the data
// by hand. This proves the fix: username/email are rejected from this
// endpoint (silently ignored, not erroring, since every other unlisted
// field in req.body was already silently ignored before this fix too --
// consistent behavior, not a new error shape), while genuine profile
// fields still work exactly as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';

let mongod;
let app;
const ORG = 'ORG-IDENTITY-FIELDS';

function tokenFor(username, role = 'user') {
  return jwt.sign({ id: crypto.randomUUID(), username, role, organization_code: ORG }, process.env.JWT_SECRET, { algorithm: 'HS256' });
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

test('PUT /api/users/:id ignores username and email even from the account\'s own owner, but still applies real profile field changes', async () => {
  const Users = require('../models/user_model');
  const AuthCredentials = require('../models/AuthCredentials');
  const bcrypt = require('bcryptjs');

  await AuthCredentials.create({ username: 'identity_test_user', password: await bcrypt.hash('OriginalPass123!', 10), user_role: 'user' });
  const profile = await Users.create({
    username: 'identity_test_user', organization_code: ORG, first_name: 'Original', last_name: 'Name',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'original@example.test', phone: '0', status: 'Active',
  });

  const res = await request(app)
    .put(`/api/users/${profile._id}`)
    .set('Authorization', `Bearer ${tokenFor('identity_test_user')}`)
    .send({
      username: 'renamed_user', // must be ignored
      email: 'renamed@example.test', // must be ignored
      first_name: 'Updated', // must apply
      city: 'New City', // must apply
    });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.username, 'identity_test_user', 'username must never change through this endpoint');
  assert.equal(res.body.email, 'original@example.test', 'email must never change through this endpoint');
  assert.equal(res.body.first_name, 'Updated', 'a genuine profile field must still update normally');
  assert.equal(res.body.city, 'New City');

  // The real regression this closes: AuthCredentials.username must still
  // match Users.username after the update attempt, so login still works.
  const auth = await AuthCredentials.findOne({ username: 'identity_test_user' });
  assert.ok(auth, 'AuthCredentials.username must still match Users.username -- this is the actual login-breaking bug the fix closes');

  const reloadedProfile = await Users.findById(profile._id);
  assert.equal(reloadedProfile.username, 'identity_test_user');
  assert.equal(reloadedProfile.email, 'original@example.test');
});

test('an admin also cannot change username/email through this endpoint, only status', async () => {
  const Users = require('../models/user_model');
  const profile = await Users.create({
    username: 'identity_admin_target', organization_code: ORG, first_name: 'A', last_name: 'B',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'target@example.test', phone: '0', status: 'Active',
  });

  const res = await request(app)
    .put(`/api/users/${profile._id}`)
    .set('Authorization', `Bearer ${tokenFor('identity_admin_actor', 'admin')}`)
    .send({ username: 'admin_renamed', email: 'admin_renamed@example.test', status: 'suspended' });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.username, 'identity_admin_target');
  assert.equal(res.body.email, 'target@example.test');
  assert.equal(res.body.status, 'suspended', 'admins must still be able to change status, unaffected by this fix');
});
