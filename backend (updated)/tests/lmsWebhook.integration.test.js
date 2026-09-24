// tests/lmsWebhook.integration.test.js
//
// Real integration test (real MongoDB, real HTTP via supertest, a real
// ApiKey document and its real hash-and-lookup auth path) for the LMS
// webhook's auth gate, input validation, and idempotency guard.
//
// NOT exercised here, honestly: an actual successful issuance. That
// requires issueOneCredential to reach the certificate microservice over
// HTTP (CERTIFICATE_SERVICE_URL) — unavailable in this environment, the
// same pre-existing, already-documented limitation as bulk issuance
// itself (see queues/bulkIssuanceWorker.js). What's verified below
// (auth, validation, idempotency) is everything this route adds on top
// of that existing, separately-tested chain.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const express = require('express');
const request = require('supertest');
const { stubEmailTransport } = require('./testHelpers/stubEmailTransport');
let emailStub;

let mongod;
let app;

test.before(async () => {
  emailStub = stubEmailTransport();
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const lmsWebhookRoutes = require('../routes/lmsWebhookRoutes');
  app = express();
  app.use(express.json());
  app.use('/api/lms', lmsWebhookRoutes);

  // Mongoose builds indexes in the background by default -- without
  // waiting for that here, the very first inserts in a fresh in-memory
  // Mongo can race ahead of the unique index actually existing, and the
  // duplicate-key test below would flake (pass validation it should fail).
  await require('../models/lmsWebhookEvent').init();
});

test.after(async () => {
  emailStub.restore();
  await mongoose.disconnect();
  await mongod.stop();
});

async function makeApiKey(organizationCode) {
  const ApiKey = require('../models/api_keys');
  const { hashApiKey } = require('../middleware/requireApiKey');
  const rawKey = `test-key-${organizationCode}-${Date.now()}`;
  await ApiKey.create({
    api_key_hash: hashApiKey(rawKey),
    organization_code: organizationCode,
    status: 'Active',
    valid_for: 365,
    requests_allowed_per_minute: 100,
  });
  return rawKey;
}

test('webhook rejects a request with no X-API-Key header', async () => {
  const res = await request(app)
    .post('/api/lms/webhook/course-completed')
    .send({ external_event_id: 'evt-1', design_code: 'DESIGN-1', achiever_username: 'someone' });
  assert.equal(res.status, 401);
});

test('webhook rejects a request with an invalid X-API-Key', async () => {
  const res = await request(app)
    .post('/api/lms/webhook/course-completed')
    .set('X-API-Key', 'not-a-real-key')
    .send({ external_event_id: 'evt-1', design_code: 'DESIGN-1', achiever_username: 'someone' });
  assert.equal(res.status, 403);
});

test('webhook rejects a valid key but missing external_event_id (would break idempotency)', async () => {
  const key = await makeApiKey('LMS-ORG-A');
  const res = await request(app)
    .post('/api/lms/webhook/course-completed')
    .set('X-API-Key', key)
    .send({ design_code: 'DESIGN-1', achiever_username: 'someone' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /external_event_id/);
});

test('webhook rejects a valid key but missing design_code', async () => {
  const key = await makeApiKey('LMS-ORG-B');
  const res = await request(app)
    .post('/api/lms/webhook/course-completed')
    .set('X-API-Key', key)
    .send({ external_event_id: 'evt-2', achiever_username: 'someone' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /design_code/);
});

test('webhook rejects when neither achiever_username nor guest_recipient is present', async () => {
  const key = await makeApiKey('LMS-ORG-C');
  const res = await request(app)
    .post('/api/lms/webhook/course-completed')
    .set('X-API-Key', key)
    .send({ external_event_id: 'evt-3', design_code: 'DESIGN-1' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /achiever_username.*guest_recipient/);
});

test('a replayed external_event_id short-circuits before attempting issuance again (idempotency)', async () => {
  const LmsWebhookEvent = require('../models/lmsWebhookEvent');
  // Simulate that this event was already processed successfully once —
  // exactly the state the route's own idempotency check looks for.
  await LmsWebhookEvent.create({
    organization_code: 'LMS-ORG-D',
    external_event_id: 'evt-already-done',
    credential_code: 'CRED-ALREADY-ISSUED-0001',
  });
  const key = await makeApiKey('LMS-ORG-D');

  const res = await request(app)
    .post('/api/lms/webhook/course-completed')
    .set('X-API-Key', key)
    .send({ external_event_id: 'evt-already-done', design_code: 'DESIGN-1', achiever_username: 'someone' });

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'already_processed');
  assert.equal(res.body.credential_code, 'CRED-ALREADY-ISSUED-0001');
});

test('the idempotency index actually rejects a duplicate (organization_code, external_event_id) pair at the database level', async () => {
  const LmsWebhookEvent = require('../models/lmsWebhookEvent');
  await LmsWebhookEvent.create({ organization_code: 'LMS-ORG-E', external_event_id: 'evt-unique', credential_code: 'CRED-1' });
  await assert.rejects(
    LmsWebhookEvent.create({ organization_code: 'LMS-ORG-E', external_event_id: 'evt-unique', credential_code: 'CRED-2' }),
    /duplicate key|E11000/
  );
  // A different organization reusing the same external_event_id is a
  // completely different event (LMS IDs aren't guaranteed globally
  // unique across every org's LMS integration) — must NOT collide.
  await assert.doesNotReject(
    LmsWebhookEvent.create({ organization_code: 'LMS-ORG-F', external_event_id: 'evt-unique', credential_code: 'CRED-3' })
  );
});
