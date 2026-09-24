// Verifies the tenant-scoped identity indexes introduced by migration
// 20260827_scope_helpdesk_identities_by_organization.  A shared corporate
// mailbox may exist in different customer organizations, but never twice in
// the same organization.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;
let User;
let OtpToken;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  User = require('../models/User');
  OtpToken = require('../models/OtpToken');
  await Promise.all([User.init(), OtpToken.init()]);
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('the same email and username can belong to different organizations, but not collide within one', async () => {
  const base = {
    name: 'Shared Support User',
    email: 'support@example.test',
    username: 'support',
    password: 'hashed-password',
  };

  await User.create({ ...base, org_code: 'ORG-ALPHA' });
  await User.create({ ...base, org_code: 'ORG-BRAVO' });

  await assert.rejects(
    User.create({ ...base, org_code: 'ORG-ALPHA' }),
    (error) => error?.code === 11000
  );
});

test('OTP records are isolated by organization for an identical email or username', async () => {
  const base = {
    emailOrUsername: 'support@example.test',
    otpHash: 'not-a-real-otp-hash',
    expiresAt: new Date(Date.now() + 60_000),
  };

  await OtpToken.create({ ...base, org_code: 'ORG-ALPHA' });
  await OtpToken.create({ ...base, org_code: 'ORG-BRAVO' });

  await assert.rejects(
    OtpToken.create({ ...base, org_code: 'ORG-ALPHA' }),
    (error) => error?.code === 11000
  );
});
