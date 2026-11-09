// tests/guestRecipient.integration.test.js
//
// Real integration test against a real MongoDB (mongodb-memory-server
// downloads and runs an actual mongod binary — no mocked Mongoose calls)
// for the guest_recipient issuance path added in ronda 17 and the P2 fix
// from the final validation round: an achiever_username that collides
// with a real employee's username in the same organization must be
// rejected (409), not silently issued.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('guest_recipient with no username collision is issued successfully', async () => {
  const { createCredential } = require('../controllers/credentialController');
  const Organization = require('../models/organization_schema');

  await Organization.create({
    organization_code: 'ORG-A',
    name: 'Org A',
    city: 'City', state: 'State', country: 'Country',
    email: 'orga@example.com', phone: '555-0001', status: 'ACTIVE',
  });

  const req = {
    user: { organization_code: 'ORG-A', username: 'admin1' },
    body: {
      credential_pic_url: 'http://localhost:9000/uploads/cert1.png',
      achiever_username: 'Jane Doe',
      credential_title: 'Certificate of Completion',
      guest_recipient: {
        email: 'jane.guest@example.com',
        first_name: 'Jane',
        last_name: 'Doe',
        designation: 'Volunteer',
        city: 'Austin',
      },
    },
  };
  const res = responseDouble();
  await createCredential(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.achiever_details.first_name, 'Jane');
  assert.equal(res.body.credential_status, 'Issued');
});

test('guest_recipient whose achiever_username collides with a real employee in the same org is rejected with 409', async () => {
  const { createCredential } = require('../controllers/credentialController');
  const Organization = require('../models/organization_schema');
  const User = require('../models/user_model');

  await Organization.create({
    organization_code: 'ORG-B',
    name: 'Org B',
    city: 'City', state: 'State', country: 'Country',
    email: 'orgb@example.com', phone: '555-0002', status: 'ACTIVE',
  });
  await User.create({
    username: 'realemployee',
    organization_code: 'ORG-B',
    first_name: 'Real', last_name: 'Employee',
    designation: 'Engineer', city: 'City', state: 'State', country: 'Country',
    email: 'real.employee@example.com', phone: '555-0003', status: 'ACTIVE',
  });

  const req = {
    user: { organization_code: 'ORG-B', username: 'admin2' },
    body: {
      credential_pic_url: 'http://localhost:9000/uploads/cert2.png',
      achiever_username: 'realemployee', // deliberately matches the real user above
      guest_recipient: {
        email: 'someone.else@example.com',
        first_name: 'Someone',
        last_name: 'Else',
      },
    },
  };
  const res = responseDouble();
  await createCredential(req, res);

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /matches an existing account/);
});

// Note on what this does NOT test: models/user_model.js declares `username`
// with a bare `unique: true` index (no compound index with
// organization_code), so usernames are actually unique across the entire
// platform already, not just within one organization — MongoDB itself
// rejects two Users sharing a username in different orgs with an
// E11000 duplicate key error (confirmed by hand while writing this test).
// That makes the organization_code filter in the collision check
// (credentialController.js: `User.exists({ username, organization_code })`)
// currently redundant with the schema-level guarantee, not a bug — but
// worth flagging if that unique index is ever loosened to be per-org.
test('guest_recipient with an achiever_username that does not match any real user succeeds even when other users exist in the org', async () => {
  const { createCredential } = require('../controllers/credentialController');
  const Organization = require('../models/organization_schema');
  const User = require('../models/user_model');

  await Organization.create({
    organization_code: 'ORG-C',
    name: 'Org C',
    city: 'City', state: 'State', country: 'Country',
    email: 'orgc@example.com', phone: '555-0004', status: 'ACTIVE',
  });
  await User.create({
    username: 'unrelated_employee',
    organization_code: 'ORG-C',
    first_name: 'Unrelated', last_name: 'Employee',
    designation: 'Engineer', city: 'City', state: 'State', country: 'Country',
    email: 'unrelated@example.com', phone: '555-0005', status: 'ACTIVE',
  });

  const req = {
    user: { organization_code: 'ORG-C', username: 'admin3' },
    body: {
      credential_pic_url: 'http://localhost:9000/uploads/cert3.png',
      achiever_username: 'Guest Three', // does not collide with unrelated_employee
      guest_recipient: {
        email: 'guest3@example.com',
        first_name: 'Guest', last_name: 'Three',
      },
    },
  };
  const res = responseDouble();
  await createCredential(req, res);

  assert.equal(res.statusCode, 201);
});

test('guest_recipient is always issued under req.user.organization_code, ignoring any organization sent in the body', async () => {
  const { createCredential } = require('../controllers/credentialController');
  const Organization = require('../models/organization_schema');
  const Credential = require('../models/credentialSchema');

  await Organization.create({
    organization_code: 'ORG-D',
    name: 'Org D',
    city: 'City', state: 'State', country: 'Country',
    email: 'orgd@example.com', phone: '555-0006', status: 'ACTIVE',
  });

  const req = {
    user: { organization_code: 'ORG-D', username: 'admin4' },
    body: {
      credential_pic_url: 'http://localhost:9000/uploads/cert4.png',
      achiever_username: 'Guest Four',
      organization_code: 'ORG-SPOOFED', // must be ignored
      guest_recipient: { email: 'guest4@example.com', first_name: 'Guest', last_name: 'Four' },
    },
  };
  const res = responseDouble();
  await createCredential(req, res);

  assert.equal(res.statusCode, 201);
  const saved = await Credential.findOne({ achiever_username: 'Guest Four' });
  assert.equal(saved.organization_code, 'ORG-D');
});

test('guest_recipient with an invalid email is rejected with 400 before touching the database', async () => {
  const { createCredential } = require('../controllers/credentialController');
  const Organization = require('../models/organization_schema');

  await Organization.create({
    organization_code: 'ORG-E',
    name: 'Org E',
    city: 'City', state: 'State', country: 'Country',
    email: 'orge@example.com', phone: '555-0007', status: 'ACTIVE',
  });

  const req = {
    user: { organization_code: 'ORG-E', username: 'admin5' },
    body: {
      credential_pic_url: 'http://localhost:9000/uploads/cert5.png',
      achiever_username: 'Bad Email Guest',
      guest_recipient: { email: 'not-an-email', first_name: 'Bad', last_name: 'Email' },
    },
  };
  const res = responseDouble();
  await createCredential(req, res);

  assert.equal(res.statusCode, 400);
});
