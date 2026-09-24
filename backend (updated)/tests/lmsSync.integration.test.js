// tests/lmsSync.integration.test.js
//
// Real MongoDB, real issuance path (issueOneCredential -- same one the
// webhook uses), real encryption round-trip for the stored token. The
// one thing genuinely mocked is the outbound HTTP call to the LMS itself
// (fetchFn) -- there's no real LMS in this environment to call, so this
// is exactly the boundary services/lmsSync.js's own comments document as
// injectable for that reason. Everything downstream of that boundary
// (retry logic, idempotency against the real LmsWebhookEvents index,
// real certificate generation via the certificate microservice, the
// visible log) is exercised for real.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'a'.repeat(32);
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';
process.env.CERTIFICATE_SERVICE_URL = process.env.CERTIFICATE_SERVICE_URL || 'http://localhost:8100';
process.env.CERTIFICATE_INTERNAL_KEY = process.env.CERTIFICATE_INTERNAL_KEY || 'test-internal-key';
// utils/lmsSyncUrl.js's SSRF allowlist -- without this, PUT /api/lms/config
// rejects even the legitimate lms.example.test URL this file's own tests
// configure below.
process.env.LMS_SYNC_ALLOWED_HOSTS = process.env.LMS_SYNC_ALLOWED_HOSTS || 'lms.example.test';

let mongod;
let app;
const ORG = 'ORG-LMS-SYNC';
let token;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  token = jwt.sign({ id: 'l1', username: 'lms_admin', role: 'admin', organization_code: ORG }, process.env.JWT_SECRET, { algorithm: 'HS256' });

  const Organization = require('../models/organization_schema');
  await Organization.create({
    organization_code: ORG, name: 'LMS Sync Org', city: 'C', state: 'S', country: 'PY',
    email: 'lmssync@example.test', phone: '0', status: 'ACTIVE', plan: 'Basic',
  });

  // A real, fetchable template PNG (copied into the storage container's
  // uploads dir for this test run) and a fully-populated text_attributes/
  // QR_CODE shape -- the Python certificate microservice (utils/main.py)
  // validates these with Pydantic and 422s on anything less, so this
  // proves out a genuinely complete real issuance, not a stub.
  const publicStorageBase = process.env.PUBLIC_STORAGE_BASE_URL || 'http://storage:9000';
  const Design = require('../models/designSchema');
  await Design.create({
    organization_code: ORG, design_code: 'DESIGN-LMS-SYNC',
    main_template_url: `${publicStorageBase}/uploads/test-template.png`,
    template_url: `${publicStorageBase}/uploads/test-template.png`,
    text_attributes: [{
      text_title: 'recipient_name',
      text: 'Placeholder',
      font_attributes: [{ font_family: 'Arial', font_size: 32, font_color: '#333333', font_weight: 'bold' }],
      positions: { X: 100, Y: 100 },
    }],
    QR_CODE: { ecoding_data: 'placeholder', X: 700, Y: 500 },
  });
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('PUT /api/lms/config stores the sync token encrypted, never in plain text', async () => {
  const res = await request(app)
    .put('/api/lms/config')
    .set('Authorization', `Bearer ${token}`)
    .send({ sync_api_url: 'https://lms.example.test/api', sync_api_token: 'super-secret-lms-token' });

  assert.equal(res.status, 200);
  assert.equal(res.body.sync_api_url, 'https://lms.example.test/api');
  assert.equal(JSON.stringify(res.body).includes('super-secret-lms-token'), false);

  const OrganizationLmsConfig = require('../models/organizationLmsConfig');
  const stored = await OrganizationLmsConfig.findOne({ organization_code: ORG }).select('+sync_api_token_encrypted');
  assert.notEqual(stored.sync_api_token_encrypted, 'super-secret-lms-token');
  const cryptoHelper = require('../utils/cryptoHelper');
  assert.equal(cryptoHelper.decrypt(stored.sync_api_token_encrypted), 'super-secret-lms-token');
});

// SSRF defense (utils/lmsSyncUrl.js) -- an org admin fully controls this
// URL, and it's fetched server-side on a schedule (scripts/syncLms.js),
// so without this a malicious admin could point it at the docker
// network's own internal services (redis, mongo, storage's internal
// port) or the cloud metadata endpoint. Both the transport/host-shape
// rules and the operator-configured allowlist are enforced here, at the
// same point-of-configuration this app actually uses (PUT /api/lms/config),
// not just unit-tested against the util in isolation.
test('PUT /api/lms/config rejects a sync_api_url that is not on the operator-approved allowlist', async () => {
  const res = await request(app)
    .put('/api/lms/config')
    .set('Authorization', `Bearer ${token}`)
    .send({ sync_api_url: 'https://not-an-approved-lms.example.net/api', sync_api_token: 'irrelevant-token' });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /not approved/i);
});

test('PUT /api/lms/config rejects sync_api_url shapes an SSRF payload would use (HTTP, IP literal, localhost, credentials-in-URL, custom port)', async () => {
  const bad = [
    'http://lms.example.test/api', // not HTTPS
    'https://127.0.0.1/api', // IP literal
    'https://169.254.169.254/latest/meta-data/', // cloud metadata IP literal
    'https://localhost/api', // localhost
    'https://user:pass@lms.example.test/api', // credentials in URL
    'https://lms.example.test:8443/api', // custom port
  ];
  for (const sync_api_url of bad) {
    const res = await request(app)
      .put('/api/lms/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ sync_api_url, sync_api_token: 'irrelevant-token' });
    assert.equal(res.status, 400, `expected ${sync_api_url} to be rejected`);
  }

  // None of the rejected attempts must have overwritten the org's real,
  // previously-validated config from the test above.
  const OrganizationLmsConfig = require('../models/organizationLmsConfig');
  const stored = await OrganizationLmsConfig.findOne({ organization_code: ORG });
  assert.equal(stored.sync_api_url, 'https://lms.example.test/api');
});

// Same documented limitation as tests/lmsWebhook.integration.test.js's
// own header comment: a full real issuance needs the certificate
// microservice actually reachable (CERTIFICATE_SERVICE_URL), which the
// standard `npm test` run doesn't have -- skips cleanly there instead of
// failing, and runs for real when CERTIFICATE_SERVICE_URL is pointed at
// a real running certificate container (see AUDIT_FIXES.md for the exact
// docker-compose network command this was verified against).
test('syncOrganization() issues a real credential for a pulled completion, and it becomes idempotent with the webhook path', async (t) => {
  try {
    await fetch(`${process.env.CERTIFICATE_SERVICE_URL}/health`, { signal: AbortSignal.timeout(1000) });
  } catch {
    return t.skip('needs a real certificate/storage microservice reachable -- not part of the standard npm test run, see AUDIT_FIXES.md');
  }
  const { syncOrganization } = require('../services/lmsSync');
  const OrganizationLmsConfig = require('../models/organizationLmsConfig');
  const config = await OrganizationLmsConfig.findOne({ organization_code: ORG }).select('+sync_api_token_encrypted');

  const fakeFetch = async () => [{
    external_event_id: 'evt-sync-1',
    achiever_username: 'sync_test_user',
    design_code: 'DESIGN-LMS-SYNC',
    credential_title: 'Synced Course',
    guest_recipient: { first_name: 'Sync', last_name: 'Test', email: 'sync_test@example.test' },
  }];

  const log = await syncOrganization(config, { fetchFn: fakeFetch });
  assert.equal(log.status, 'success');
  assert.equal(log.records_found, 1);
  assert.equal(log.records_issued, 1);

  const LmsWebhookEvent = require('../models/lmsWebhookEvent');
  const eventRecord = await LmsWebhookEvent.findOne({ organization_code: ORG, external_event_id: 'evt-sync-1' });
  assert.ok(eventRecord, 'the pulled completion must be recorded in the same idempotency table the webhook uses');

  // A second sync pass over the same completion must not double-issue.
  const secondLog = await syncOrganization(config, { fetchFn: fakeFetch });
  assert.equal(secondLog.records_already_processed, 1);
  assert.equal(secondLog.records_issued, 0);
});

test('syncOrganization() retries on a transient fetch failure and succeeds once the LMS responds', async () => {
  const { syncOrganization, MAX_ATTEMPTS } = require('../services/lmsSync');
  const OrganizationLmsConfig = require('../models/organizationLmsConfig');
  const config = await OrganizationLmsConfig.findOne({ organization_code: ORG }).select('+sync_api_token_encrypted');

  let calls = 0;
  const flakyFetch = async () => {
    calls += 1;
    if (calls < MAX_ATTEMPTS) throw new Error('ECONNRESET (simulated LMS outage)');
    return [];
  };

  const log = await syncOrganization(config, { fetchFn: flakyFetch });
  assert.equal(calls, MAX_ATTEMPTS, 'must have retried until it succeeded, not given up after the first failure');
  assert.equal(log.status, 'success');
  assert.equal(log.attempts, MAX_ATTEMPTS);
});

test('syncOrganization() logs a visible failure after exhausting all retries, and does not crash the run', async () => {
  const { syncOrganization } = require('../services/lmsSync');
  const OrganizationLmsConfig = require('../models/organizationLmsConfig');
  const config = await OrganizationLmsConfig.findOne({ organization_code: ORG }).select('+sync_api_token_encrypted');

  const alwaysFails = async () => { throw new Error('LMS is permanently unreachable (simulated)'); };
  const log = await syncOrganization(config, { fetchFn: alwaysFails });
  assert.equal(log.status, 'failed');
  assert.match(log.error_message, /permanently unreachable/);

  const res = await request(app)
    .get('/api/lms/sync-log')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  const failedEntry = res.body.logs.find((l) => l.status === 'failed');
  assert.ok(failedEntry, 'GET /api/lms/sync-log must show the failed run');
});

test('a second organization cannot see the first organization\'s sync log', async () => {
  const ORG_B = 'ORG-LMS-SYNC-B';
  const Organization = require('../models/organization_schema');
  await Organization.create({
    organization_code: ORG_B, name: 'Org B', city: 'C', state: 'S', country: 'PY',
    email: 'orgb-lms@example.test', phone: '0', status: 'ACTIVE', plan: 'Free',
  });
  const tokenB = jwt.sign({ id: 'b1', username: 'lms_admin_b', role: 'admin', organization_code: ORG_B }, process.env.JWT_SECRET, { algorithm: 'HS256' });

  const res = await request(app)
    .get('/api/lms/sync-log')
    .set('Authorization', `Bearer ${tokenB}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 0, 'Org B must see none of Org A\'s sync log entries');
});
