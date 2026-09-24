// tests/passwordReset.integration.test.js
//
// P1 finding, audit round: there was no self-service way to recover an
// already-activated account's forgotten password -- resendActivation only
// works before an account's first activation. This proves the real fix
// end to end, against real HTTP routes and a real MongoDB: request a
// reset, extract the real emailed token (via the shared SMTP stub, same
// mechanism tests/expiryNotifications.integration.test.js already uses),
// submit it to actually change the password, then confirm the new
// password logs in and the old one no longer does.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { stubEmailTransport } = require('./testHelpers/stubEmailTransport');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';
process.env.EMAIL_USER = process.env.EMAIL_USER || 'noreply@example.test';

let mongod;
let app;
let emailStub;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  emailStub = stubEmailTransport();

  const express = require('express');
  const { forgotPassword, resetPassword, login } = require('../controllers/authController');
  app = express();
  app.use(express.json());
  app.post('/api/auth/forgot-password', forgotPassword);
  app.post('/api/auth/reset-password', resetPassword);
  app.post('/api/auth/login', login);

  const AuthCred = require('../models/AuthCredentials');
  const UserProfile = require('../models/user_model');
  const passwordHash = await bcrypt.hash('OriginalPassword123!', 12);
  await AuthCred.create({ username: 'reset_test_user', password: passwordHash, user_role: 'user' });
  await UserProfile.create({
    username: 'reset_test_user', organization_code: 'ORG-RESET', first_name: 'R', last_name: 'U',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'reset_target@example.test', phone: '0', status: 'Active',
  });

  // A never-activated account (still has activation_token_hash) -- must
  // never be reset through this flow, since it has no real password yet.
  await AuthCred.create({
    username: 'never_activated_user',
    password: await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 12),
    user_role: 'user',
    activation_token_hash: 'placeholder-hash',
    activation_expires_at: new Date(Date.now() + 60 * 60 * 1000),
  });
  await UserProfile.create({
    username: 'never_activated_user', organization_code: 'ORG-RESET', first_name: 'N', last_name: 'A',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'never_activated@example.test', phone: '0', status: 'pending',
  });
});

test.after(async () => {
  emailStub.restore();
  await mongoose.disconnect();
  await mongod.stop();
});

function extractResetToken(sentMail) {
  const html = sentMail[sentMail.length - 1].html;
  const match = html.match(/reset-password#username=[^&]+&token=([^"&]+)/);
  return decodeURIComponent(match[1]);
}

test('POST /api/auth/forgot-password for a real, active account sends a real reset email with a usable token', async () => {
  const res = await request(app).post('/api/auth/forgot-password').send({ username: 'reset_test_user' });
  assert.equal(res.status, 202);
  assert.equal(emailStub.sent.length, 1);
  assert.equal(emailStub.sent[0].to, 'reset_target@example.test');
});

test('POST /api/auth/forgot-password also accepts the legacy usernameOrEmail field with an institutional email', async () => {
  emailStub.sent.length = 0;
  const res = await request(app).post('/api/auth/forgot-password').send({ usernameOrEmail: 'reset_target@example.test' });
  assert.equal(res.status, 202);
  assert.equal(emailStub.sent.length, 1);
  assert.equal(emailStub.sent[0].to, 'reset_target@example.test');
});

test('POST /api/auth/forgot-password returns the exact same generic response for a username that does not exist (no enumeration)', async () => {
  const realRes = await request(app).post('/api/auth/forgot-password').send({ username: 'reset_test_user' });
  const fakeRes = await request(app).post('/api/auth/forgot-password').send({ username: 'does_not_exist_at_all' });
  assert.equal(realRes.status, fakeRes.status);
  assert.deepEqual(realRes.body, fakeRes.body);
});

test('POST /api/auth/forgot-password for a never-activated account does not send a reset email (that account has no password to reset)', async () => {
  const before = emailStub.sent.length;
  const res = await request(app).post('/api/auth/forgot-password').send({ username: 'never_activated_user' });
  assert.equal(res.status, 202);
  assert.equal(emailStub.sent.length, before, 'no new email should have been sent for a never-activated account');
});

test('the full loop: request reset -> use the real emailed token -> new password works -> old password is rejected', async () => {
  emailStub.sent.length = 0;
  const forgotRes = await request(app).post('/api/auth/forgot-password').send({ username: 'reset_test_user' });
  assert.equal(forgotRes.status, 202);
  const token = extractResetToken(emailStub.sent);
  assert.ok(token.length >= 32);

  const resetRes = await request(app).post('/api/auth/reset-password').send({
    username: 'reset_test_user', token, password: 'BrandNewPassword456!', confirmPassword: 'BrandNewPassword456!',
  });
  assert.equal(resetRes.status, 200);

  const oldLogin = await request(app).post('/api/auth/login').send({ username: 'reset_test_user', password: 'OriginalPassword123!' });
  assert.equal(oldLogin.status, 400, 'the old password must no longer work');

  const newLogin = await request(app).post('/api/auth/login').send({ username: 'reset_test_user', password: 'BrandNewPassword456!' });
  assert.equal(newLogin.status, 200, 'the new password must work');
});

test('the same reset token cannot be used twice', async () => {
  emailStub.sent.length = 0;
  await request(app).post('/api/auth/forgot-password').send({ username: 'reset_test_user' });
  const token = extractResetToken(emailStub.sent);

  const first = await request(app).post('/api/auth/reset-password').send({
    username: 'reset_test_user', token, password: 'FirstUseOnly789!', confirmPassword: 'FirstUseOnly789!',
  });
  assert.equal(first.status, 200);

  const second = await request(app).post('/api/auth/reset-password').send({
    username: 'reset_test_user', token, password: 'SecondAttempt000!', confirmPassword: 'SecondAttempt000!',
  });
  assert.equal(second.status, 400, 'a used token must be rejected on replay');
});

test('an unknown or garbage token is rejected with 400, not a 500', async () => {
  const res = await request(app).post('/api/auth/reset-password').send({
    username: 'reset_test_user', token: 'a'.repeat(43), password: 'WhateverPassword123!', confirmPassword: 'WhateverPassword123!',
  });
  assert.equal(res.status, 400);
});

test('POST /api/auth/reset-password rejects mismatched confirmPassword', async () => {
  const res = await request(app).post('/api/auth/reset-password').send({
    username: 'reset_test_user', token: 'a'.repeat(43), password: 'PasswordOne12345!', confirmPassword: 'PasswordTwo12345!',
  });
  assert.equal(res.status, 400);
});
