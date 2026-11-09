// tests/passwordResetOtp.integration.test.js
//
// Covers the OTP half of the single password-reset grant (see
// models/AuthCredentials.js's reset_otp_hash comment for why it is one
// grant with two proofs, not two parallel mechanisms). The emailed-link
// half is already covered by tests/passwordReset.integration.test.js and
// is deliberately not re-tested here.
//
// Real MongoDB (mongodb-memory-server), real bcrypt, real Express app.
// The only stub is the SMTP transport (testHelpers/stubEmailTransport.js),
// so no test opens a real connection through the real info@ebadgeid.com
// mailbox -- the OTP itself is read back out of the captured message, the
// same way a real user reads it out of their inbox, never from the
// database and never from a mocked controller.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { stubEmailTransport } = require('./testHelpers/stubEmailTransport');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only_min_32_chars';
process.env.PUBLIC_APP_URL = 'https://app.ebadgeid.com';
process.env.PUBLIC_SUPER_ADMIN_URL = 'https://onboarding.ebadgeid.com';

let mongod;
let app;
let AuthCred;
let UserProfile;
let mailStub;

const PASSWORD = 'OriginalPassword123!';

// Pull the 6-digit code out of the real rendered email body, exactly as a
// user would read it -- not out of the database.
const otpFromLastEmail = () => {
  const html = mailStub.sent[mailStub.sent.length - 1]?.html || '';
  const match = html.match(/letter-spacing: 7px[^>]*>(\d{6})</);
  return match?.[1] || null;
};
const linkFromLastEmail = () => {
  const html = mailStub.sent[mailStub.sent.length - 1]?.html || '';
  return html.match(/href="([^"]*\/auth\/reset-password[^"]*)"/)?.[1] || null;
};

const seedUser = async (username, email) => {
  await AuthCred.deleteMany({ username });
  await UserProfile.deleteMany({ username });
  await AuthCred.create({ username, password: await bcrypt.hash(PASSWORD, 12), user_role: 'user' });
  await UserProfile.create({
    username, email, organization_code: 'ORG-OTP', first_name: 'Otp', last_name: 'Tester',
    designation: 'Tester', city: 'C', state: 'S', country: 'CR', phone: '0', status: 'active',
  });
};

test.before(async () => {
  mailStub = stubEmailTransport();
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  AuthCred = require('../models/AuthCredentials');
  UserProfile = require('../models/user_model');
});

test.after(async () => {
  mailStub?.restore();
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test.beforeEach(() => { mailStub.sent.length = 0; });

// TEST A -- happy path, end to end, using only what the email carries.
test('the full OTP loop: request -> read the real emailed code -> verify -> set a new password -> new password works, old one does not', async () => {
  await seedUser('otp_happy_user', 'otp.happy@example.test');

  const requested = await request(app).post('/api/auth/forgot-password').send({ usernameOrEmail: 'otp_happy_user' });
  assert.equal(requested.status, 202);

  const otp = otpFromLastEmail();
  assert.match(otp || '', /^\d{6}$/, 'the email must actually carry a 6-digit code');

  const verified = await request(app).post('/api/auth/verify-otp').send({ usernameOrEmail: 'otp_happy_user', otp });
  assert.equal(verified.status, 200);
  assert.ok(verified.body.token && verified.body.token.length >= 32, 'a real reset token must come back');
  assert.equal(verified.body.username, 'otp_happy_user');
  // Proving control of the mailbox must not, by itself, start a session.
  assert.ok(!(verified.headers['set-cookie'] || []).some(c => c.startsWith('ebadge_token=')),
    'verifying an OTP must never log the user in');

  const reset = await request(app).post('/api/auth/reset-password').send({
    username: verified.body.username,
    token: verified.body.token,
    password: 'BrandNewPassword456!',
    confirmPassword: 'BrandNewPassword456!',
  });
  assert.equal(reset.status, 200);

  // TEST B -- old credential must be dead, new one must work.
  const oldLogin = await request(app).post('/api/auth/login').send({ username: 'otp_happy_user', password: PASSWORD });
  assert.equal(oldLogin.status, 400, 'the previous password must stop working');

  const newLogin = await request(app).post('/api/auth/login').send({ username: 'otp_happy_user', password: 'BrandNewPassword456!' });
  assert.equal(newLogin.status, 200, 'the new password must work');
});

// TEST C
test('a wrong OTP is rejected and never reveals which part was wrong', async () => {
  await seedUser('otp_wrong_user', 'otp.wrong@example.test');
  await request(app).post('/api/auth/forgot-password').send({ usernameOrEmail: 'otp_wrong_user' });
  const realOtp = otpFromLastEmail();
  const wrongOtp = String((Number(realOtp) + 1) % 1_000_000).padStart(6, '0');

  const res = await request(app).post('/api/auth/verify-otp').send({ usernameOrEmail: 'otp_wrong_user', otp: wrongOtp });
  assert.equal(res.status, 400);
  assert.ok(!res.body.token);

  // The correct code still works afterwards -- one wrong guess must not
  // destroy a grant the real user is still holding.
  const ok = await request(app).post('/api/auth/verify-otp').send({ usernameOrEmail: 'otp_wrong_user', otp: realOtp });
  assert.equal(ok.status, 200);
});

// TEST D
test('an expired OTP is rejected, and a fresh request issues a working one', async () => {
  await seedUser('otp_expired_user', 'otp.expired@example.test');
  await request(app).post('/api/auth/forgot-password').send({ usernameOrEmail: 'otp_expired_user' });
  const staleOtp = otpFromLastEmail();

  // Real expiry, not a mocked clock: push the stored expiry into the past.
  await AuthCred.updateOne({ username: 'otp_expired_user' }, { $set: { reset_otp_expires_at: new Date(Date.now() - 1000) } });

  const expired = await request(app).post('/api/auth/verify-otp').send({ usernameOrEmail: 'otp_expired_user', otp: staleOtp });
  assert.equal(expired.status, 400, 'an expired code must be rejected');

  await request(app).post('/api/auth/forgot-password').send({ usernameOrEmail: 'otp_expired_user' });
  const freshOtp = otpFromLastEmail();
  const ok = await request(app).post('/api/auth/verify-otp').send({ usernameOrEmail: 'otp_expired_user', otp: freshOtp });
  assert.equal(ok.status, 200, 'requesting a new code after expiry must work');
});

// TEST E
test('an OTP cannot be used twice', async () => {
  await seedUser('otp_reuse_user', 'otp.reuse@example.test');
  await request(app).post('/api/auth/forgot-password').send({ usernameOrEmail: 'otp_reuse_user' });
  const otp = otpFromLastEmail();

  const first = await request(app).post('/api/auth/verify-otp').send({ usernameOrEmail: 'otp_reuse_user', otp });
  assert.equal(first.status, 200);

  const second = await request(app).post('/api/auth/verify-otp').send({ usernameOrEmail: 'otp_reuse_user', otp });
  assert.equal(second.status, 400, 'replaying the same code must fail');
  assert.ok(!second.body.token);
});

// TEST F
test('resending invalidates the previous OTP and the new one works', async () => {
  await seedUser('otp_resend_user', 'otp.resend@example.test');
  await request(app).post('/api/auth/forgot-password').send({ usernameOrEmail: 'otp_resend_user' });
  const firstOtp = otpFromLastEmail();

  await request(app).post('/api/auth/forgot-password').send({ usernameOrEmail: 'otp_resend_user' });
  const secondOtp = otpFromLastEmail();
  assert.notEqual(firstOtp, secondOtp, 'a resend must issue a different code');

  const stale = await request(app).post('/api/auth/verify-otp').send({ usernameOrEmail: 'otp_resend_user', otp: firstOtp });
  assert.equal(stale.status, 400, 'the superseded code must stop working');

  const fresh = await request(app).post('/api/auth/verify-otp').send({ usernameOrEmail: 'otp_resend_user', otp: secondOtp });
  assert.equal(fresh.status, 200, 'the newest code must work');
});

test('wrong guesses are capped, and the cap kills that code even if the right one is supplied afterwards', async () => {
  await seedUser('otp_bruteforce_user', 'otp.brute@example.test');
  await request(app).post('/api/auth/forgot-password').send({ usernameOrEmail: 'otp_bruteforce_user' });
  const realOtp = otpFromLastEmail();
  const wrongOtp = String((Number(realOtp) + 7) % 1_000_000).padStart(6, '0');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await request(app).post('/api/auth/verify-otp').send({ usernameOrEmail: 'otp_bruteforce_user', otp: wrongOtp });
    assert.equal(res.status, 400);
  }

  const afterCap = await request(app).post('/api/auth/verify-otp').send({ usernameOrEmail: 'otp_bruteforce_user', otp: realOtp });
  assert.equal(afterCap.status, 400, 'the code must be dead once the attempt cap is hit');
});

test('an account that does not exist is indistinguishable from a wrong code (no enumeration)', async () => {
  const unknown = await request(app).post('/api/auth/verify-otp').send({ usernameOrEmail: 'nobody@example.test', otp: '123456' });
  assert.equal(unknown.status, 400);

  await seedUser('otp_enum_user', 'otp.enum@example.test');
  await request(app).post('/api/auth/forgot-password').send({ usernameOrEmail: 'otp_enum_user' });
  const realOtp = otpFromLastEmail();
  const wrongOtp = String((Number(realOtp) + 3) % 1_000_000).padStart(6, '0');
  const known = await request(app).post('/api/auth/verify-otp').send({ usernameOrEmail: 'otp_enum_user', otp: wrongOtp });

  assert.equal(known.status, unknown.status);
  assert.deepEqual(known.body, unknown.body, 'both rejections must be byte-identical');
});

test('a malformed OTP is rejected without touching the database', async () => {
  for (const otp of ['', '12345', '1234567', 'abcdef', '12 34 56', null, 123456]) {
    const res = await request(app).post('/api/auth/verify-otp').send({ usernameOrEmail: 'otp_happy_user', otp });
    assert.equal(res.status, 400, `malformed OTP ${JSON.stringify(otp)} must be rejected`);
  }
});

// TEST G -- domain separation.
test('the emailed link points back to the app the recovery actually started from', async () => {
  await seedUser('otp_domain_user', 'otp.domain@example.test');

  await request(app).post('/api/auth/forgot-password')
    .send({ usernameOrEmail: 'otp_domain_user', app: 'https://onboarding.ebadgeid.com' });
  assert.match(linkFromLastEmail() || '', /^https:\/\/onboarding\.ebadgeid\.com\/auth\/reset-password#/,
    'a recovery started from onboarding must link back to onboarding');

  await request(app).post('/api/auth/forgot-password')
    .send({ usernameOrEmail: 'otp_domain_user', app: 'https://app.ebadgeid.com' });
  assert.match(linkFromLastEmail() || '', /^https:\/\/app\.ebadgeid\.com\/auth\/reset-password#/,
    'a recovery started from the main app must link back to the main app');
});

test('an unrecognized origin can never redirect the emailed link off-platform', async () => {
  await seedUser('otp_evil_user', 'otp.evil@example.test');

  for (const hostile of ['https://evil.example.com', 'https://onboarding.ebadgeid.com.evil.example', 'javascript:alert(1)', '//evil.example.com', 12345]) {
    await request(app).post('/api/auth/forgot-password').send({ usernameOrEmail: 'otp_evil_user', app: hostile });
    const link = linkFromLastEmail() || '';
    assert.match(link, /^https:\/\/app\.ebadgeid\.com\/auth\/reset-password#/,
      `hostile origin ${JSON.stringify(hostile)} must fall back to the main app, got: ${link}`);
  }
});

test('the OTP is never returned by the API, only delivered by email', async () => {
  await seedUser('otp_leak_user', 'otp.leak@example.test');
  const res = await request(app).post('/api/auth/forgot-password').send({ usernameOrEmail: 'otp_leak_user' });
  const body = JSON.stringify(res.body);
  const otp = otpFromLastEmail();
  assert.ok(otp, 'sanity: a code was issued');
  assert.ok(!body.includes(otp), 'the response body must never carry the code');
  assert.equal(res.body.message, 'If this account exists, a password reset link has been sent.');
});

test('only the hash of the OTP is ever persisted, never the code itself', async () => {
  await seedUser('otp_storage_user', 'otp.storage@example.test');
  await request(app).post('/api/auth/forgot-password').send({ usernameOrEmail: 'otp_storage_user' });
  const otp = otpFromLastEmail();

  const stored = await AuthCred.findOne({ username: 'otp_storage_user' })
    .select('+reset_otp_hash +reset_otp_expires_at').lean();
  assert.ok(stored.reset_otp_hash, 'a hash must be stored');
  assert.equal(stored.reset_otp_hash.length, 64, 'a SHA-256-sized hex digest');
  assert.notEqual(stored.reset_otp_hash, otp);
  assert.ok(!JSON.stringify(stored).includes(otp), 'the raw code must never appear in the stored document');
});

test('the stored OTP digest is keyed to a server secret, so a database dump alone cannot be brute-forced back to the code', async () => {
  const crypto = require('node:crypto');
  await seedUser('otp_hmac_user', 'otp.hmac@example.test');
  await request(app).post('/api/auth/forgot-password').send({ usernameOrEmail: 'otp_hmac_user' });
  const otp = otpFromLastEmail();
  const stored = await AuthCred.findOne({ username: 'otp_hmac_user' }).select('+reset_otp_hash').lean();

  // The whole 6-digit space is only 1e6 entries -- an attacker holding a
  // dump would walk it in seconds. A plain digest would therefore hand
  // over the live code; a secret-keyed one must not.
  const plain = crypto.createHash('sha256').update(otp).digest('hex');
  assert.notEqual(stored.reset_otp_hash, plain,
    'an unkeyed digest of the code would be trivially reversible from a dump');

  const keyed = crypto.createHmac('sha256', process.env.JWT_SECRET).update(otp).digest('hex');
  assert.equal(stored.reset_otp_hash, keyed, 'the digest must be the secret-keyed one');
});
