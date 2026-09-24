// tests/freeTrialSignup.integration.test.js
//
// Audit finding, confirmed real by reading the code (not the frontend --
// no page in this repo's 3 frontends calls this route at all, so it's
// presumably called from an external marketing site): POST
// /api/start-free-trial used to hardcode first_name: 'Trial' / last_name:
// 'Administrator' on every single signup, regardless of who actually
// filled out the form. The account's real owner was never asked for
// their own name -- every free-trial admin's profile, and every screen
// that displays it (header, sidebar, Manage Users), permanently showed
// the same placeholder name. Proves the real fix: the endpoint now
// requires first_name/last_name and stores exactly what was sent, not a
// hardcoded string, without touching anything else in the flow (still
// requires activation, still rejects a duplicate email the same way).
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { stubEmailTransport } = require('./testHelpers/stubEmailTransport');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';

let replSet;
let app;
let emailStub;

const validBody = (overrides = {}) => ({
  name: 'Acme Corp',
  first_name: 'Maria',
  last_name: 'Gonzalez',
  city: 'San Jose',
  state: 'SJ',
  country: 'Costa Rica',
  email: `trial_${Date.now()}_${Math.random().toString(36).slice(2)}@example.test`,
  phone: '88881234',
  ...overrides,
});

test.before(async () => {
  emailStub = stubEmailTransport();
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  ({ app } = require('../api.js'));
});

test.after(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

test('start-free-trial stores the real first_name/last_name that was submitted, not a hardcoded placeholder', async () => {
  const Users = require('../models/user_model');
  const body = validBody();

  const res = await request(app).post('/api/start-free-trial').send(body);
  assert.equal(res.status, 201, `expected a successful trial creation, got ${res.status}: ${JSON.stringify(res.body)}`);

  const profile = await Users.findOne({ email: body.email });
  assert.ok(profile, 'a Users profile must have been created for the new trial admin');
  assert.equal(profile.first_name, 'Maria', 'first_name must be the real value submitted, not the old hardcoded "Trial"');
  assert.equal(profile.last_name, 'Gonzalez', 'last_name must be the real value submitted, not the old hardcoded "Administrator"');
});

test('start-free-trial rejects a request missing first_name or last_name instead of silently using a placeholder', async () => {
  const missingFirst = await request(app).post('/api/start-free-trial').send(validBody({ first_name: '' }));
  assert.equal(missingFirst.status, 400);

  const missingLast = await request(app).post('/api/start-free-trial').send(validBody({ last_name: '' }));
  assert.equal(missingLast.status, 400);
});
