// tests/expiryNotifications.integration.test.js
//
// Real MongoDB, no mocks at the DB layer. Email sending is stubbed (see
// testHelpers/stubEmailTransport.js) purely so this never makes a real
// SMTP connection through the real mailbox configured as EMAIL_USER --
// the notification logic under test never depended on the email actually
// sending in the first place: notifyExpiringCredentials wraps its
// emailService call in its own try/catch, so this test is (and always
// was) really verifying that a failed/skipped email never breaks the
// in-app notification or the idempotency marker.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { stubEmailTransport } = require('./testHelpers/stubEmailTransport');
let emailStub;

process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';
process.env.CONTRACT_APP_URL = process.env.CONTRACT_APP_URL || 'https://contract.example.test';

let mongod;

test.before(async () => {
  emailStub = stubEmailTransport();
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

test.after(async () => {
  emailStub.restore();
  await mongoose.disconnect();
  await mongod.stop();
});

function isoDateInDays(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

async function seedCredential(overrides = {}) {
  const Credential = require('../models/credentialSchema');
  const code = 'CRED-EXP-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  return Credential.create({
    credential_code: code,
    credential_title: 'Expiry Test Credential',
    credential_issue_date: '2026-01-01',
    credential_expiry_date: isoDateInDays(10),
    credential_pic_url: 'https://example.test/x.png',
    credential_blockchain_hashes: crypto.createHash('sha256').update(code).digest('hex'),
    achiever_username: 'expiry_test_user',
    organization_code: 'ORG-EXPIRY',
    credential_status: 'Claimed',
    ...overrides,
  });
}

async function seedOrgWithAdmin() {
  const Users = require('../models/user_model');
  const AuthCredentials = require('../models/AuthCredentials');
  await Users.findOneAndUpdate(
    { username: 'expiry_test_user' },
    { username: 'expiry_test_user', organization_code: 'ORG-EXPIRY', first_name: 'Test', last_name: 'User', designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'expiry_test_user@example.test', phone: '0', status: 'Active' },
    { upsert: true }
  );
  await Users.findOneAndUpdate(
    { username: 'expiry_test_admin' },
    { username: 'expiry_test_admin', organization_code: 'ORG-EXPIRY', first_name: 'Admin', last_name: 'A', designation: 'Administrator', city: 'C', state: 'S', country: 'PY', email: 'expiry_test_admin@example.test', phone: '0', status: 'Active' },
    { upsert: true }
  );
  await AuthCredentials.findOneAndUpdate(
    { username: 'expiry_test_admin' },
    { username: 'expiry_test_admin', password: 'irrelevant-hash', user_role: 'admin' },
    { upsert: true }
  );
}

test('findExpiringCredentials() finds a Claimed credential expiring within the window, not one outside it', async () => {
  const { findExpiringCredentials } = require('../utils/expiryNotifications');
  const inWindow = await seedCredential({ credential_expiry_date: isoDateInDays(5) });
  const outsideWindow = await seedCredential({ credential_expiry_date: isoDateInDays(90) });

  const found = await findExpiringCredentials(30);
  const foundIds = found.map((c) => String(c._id));

  assert.ok(foundIds.includes(String(inWindow._id)));
  assert.ok(!foundIds.includes(String(outsideWindow._id)));
});

test('findExpiringCredentials() excludes non-Claimed credentials', async () => {
  const { findExpiringCredentials } = require('../utils/expiryNotifications');
  const issued = await seedCredential({ credential_status: 'Issued', credential_expiry_date: isoDateInDays(5) });
  const found = await findExpiringCredentials(30);
  assert.ok(!found.map((c) => String(c._id)).includes(String(issued._id)));
});

test('notifyExpiringCredentials() creates real in-app notifications for both the recipient and the org admin', async () => {
  await seedOrgWithAdmin();
  const { notifyExpiringCredentials } = require('../utils/expiryNotifications');
  const Notifications = require('../models/notificationsSchema');
  const credential = await seedCredential({ credential_expiry_date: isoDateInDays(7) });

  const results = await notifyExpiringCredentials(30);
  assert.ok(results.notified >= 1);

  const recipientNotif = await Notifications.findOne({ email: 'expiry_test_user@example.test' }).sort({ _id: -1 });
  assert.ok(recipientNotif);
  assert.match(recipientNotif.notification_title, /expiring in \d+ days?/);

  const adminNotif = await Notifications.findOne({ email: 'expiry_test_admin@example.test' }).sort({ _id: -1 });
  assert.ok(adminNotif, 'the organization admin must also get a real notification');

  const Credential = require('../models/credentialSchema');
  const updated = await Credential.findById(credential._id);
  assert.ok(updated.expiry_notified_at instanceof Date);
});

test('notifyExpiringCredentials() is idempotent — a second run does not re-notify the same credential', async () => {
  await seedOrgWithAdmin();
  const { notifyExpiringCredentials } = require('../utils/expiryNotifications');
  await seedCredential({ credential_expiry_date: isoDateInDays(8) });

  const first = await notifyExpiringCredentials(30);
  const second = await notifyExpiringCredentials(30);

  assert.ok(first.notified >= 1);
  assert.equal(second.notified, 0, 'a credential already notified must not be picked up again');
});

test('notifyExpiringCredentials() skips a guest-issued credential with no persisted recipient email without crashing the batch', async () => {
  await seedOrgWithAdmin();
  const { notifyExpiringCredentials } = require('../utils/expiryNotifications');
  await seedCredential({ achiever_username: 'no_such_user_account', credential_expiry_date: isoDateInDays(9) });

  const results = await notifyExpiringCredentials(30);
  assert.ok(results.skipped_no_recipient_email >= 1);
  assert.ok(results.notified >= 1, 'the credential is still marked notified (org admin still gets theirs) even without a recipient email');
});
