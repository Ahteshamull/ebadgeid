// tests/certificatePreviewRenderOnce.integration.test.js
//
// Point 3 (Credential Studio closure round): "render -> preview ->
// confirmation -> same image -> credential" must hold strictly -- the
// frontend (credentials/page.js) calls generate-certificate exactly once
// on Preview (handleGeneratePreview) and reuses that exact URL on Confirm
// (handleConfirmIssue -> createCredential), never rendering a second time.
// This proves the invariant at the level that actually matters: a REAL
// local HTTP server standing in for the certificate microservice counts
// every request it receives, across the exact same two backend calls the
// frontend makes (generate-certificate, then create) -- not a mocked
// fetch, a real server on a real port.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const http = require('http');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { stubEmailTransport } = require('./testHelpers/stubEmailTransport');
let emailStub;

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';
process.env.CERTIFICATE_INTERNAL_KEY = process.env.CERTIFICATE_INTERNAL_KEY || 'test-internal-key';

let mongod;
let app;
let fakeCertServer;
let fakeCertServerPort;
let renderRequestCount = 0;
let shouldFailNextRender = false;

// A minimal, real 1x1 PNG -- the actual bytes generateCertificate's
// PNG_SIGNATURE check must accept.
const MINIMAL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test.before(async () => {
  emailStub = stubEmailTransport();
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  fakeCertServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/generate-certificate') {
      renderRequestCount += 1;
      if (shouldFailNextRender) {
        shouldFailNextRender = false;
        res.writeHead(500);
        return res.end('simulated render failure');
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(MINIMAL_PNG);
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => fakeCertServer.listen(0, resolve));
  fakeCertServerPort = fakeCertServer.address().port;
  process.env.CERTIFICATE_SERVICE_URL = `http://127.0.0.1:${fakeCertServerPort}`;

  ({ app } = require('../api.js'));
});

test.after(async () => {
  emailStub.restore();
  await mongoose.disconnect();
  await mongod.stop();
  await new Promise((resolve) => fakeCertServer.close(resolve));
});

function tokenFor(orgCode, role, username) {
  return jwt.sign({ id: crypto.randomUUID(), username, role, organization_code: orgCode }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

// createCredential sits behind checkCredentialLimit, which 403s outright
// with no Organization/Plan documents to look up (see
// tests/customFieldsIssuance.integration.test.js's identical setup).
async function seedOrgAndPlan(orgCode) {
  const Organization = require('../models/organization_schema');
  const Plan = require('../models/plan_schema');
  await Organization.create({ organization_code: orgCode, name: `${orgCode} Org`, city: 'C', state: 'S', country: 'PY', email: `${orgCode.toLowerCase()}@example.test`, phone: '0', status: 'ACTIVE', plan: 'Free' });
  await Plan.findOneAndUpdate({ name: 'Free' }, { name: 'Free', max_users: 5, max_credentials_per_month: 25, max_api_calls_per_month: 500 }, { upsert: true });
}

test('a full preview -> confirm cycle calls the certificate renderer exactly once, and the issued credential uses that exact image', async () => {
  const ORG = 'ORG-RENDER-ONCE';
  const admin = tokenFor(ORG, 'admin', 'render_once_admin');

  const UserProfile = require('../models/user_model');
  await UserProfile.create({ username: 'render_once_recipient', organization_code: ORG, first_name: 'R', last_name: 'One', designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'renderonce@example.test', phone: '0', status: 'Active' });
  await seedOrgAndPlan(ORG);

  const designRes = await request(app).post('/api/designs').set('Authorization', `Bearer ${admin}`).send({
    main_template_url: 'https://example.test/t.png', template_url: 'https://example.test/t.png', credential_title: 'Render Once Template',
    text_attributes: [{ text_title: 'recipient_name', text: 'Name', font_attributes: [{ font_family: 'Georgia', font_size: 24, font_color: '#000', font_weight: 'normal' }], positions: { X: 10, Y: 10 } }],
    QR_CODE: { ecoding_data: 'placeholder', X: 0, Y: 0 },
  });
  const designCode = designRes.body.data.design_code;
  await request(app).post(`/api/designs/${designCode}/publish`).set('Authorization', `Bearer ${admin}`);

  const reserveRes = await request(app).post('/api/credentials/reserve-code').set('Authorization', `Bearer ${admin}`);
  const credentialCode = reserveRes.body.credential_code;

  const before = renderRequestCount;

  // Step 1: Preview (exactly what handleGeneratePreview does)
  const previewRes = await request(app).post('/api/credentials/generate-certificate').set('Authorization', `Bearer ${admin}`).send({
    design_code: designCode, achiever_username: 'render_once_recipient', credential_code: credentialCode,
  });
  assert.equal(previewRes.status, 201);
  const previewedUrl = previewRes.body.url;
  assert.equal(renderRequestCount, before + 1, 'exactly one render must have happened for the preview');

  // Step 2: Confirm (exactly what handleConfirmIssue does -- reuses the
  // SAME url, no second render call anywhere in this path)
  const confirmRes = await request(app).post('/api/credentials/create').set('Authorization', `Bearer ${admin}`).send({
    credential_pic_url: previewedUrl, achiever_username: 'render_once_recipient', credential_code: credentialCode,
  });
  assert.equal(confirmRes.status, 201, JSON.stringify(confirmRes.body));
  assert.equal(renderRequestCount, before + 1, 'confirming must NOT trigger a second render -- the renderer must have executed exactly once for this whole cycle');

  const Credential = require('../models/credentialSchema');
  const saved = await Credential.findOne({ credential_code: credentialCode }).lean();
  assert.equal(saved.credential_pic_url, previewedUrl, 'the persisted credential image must be exactly the one shown at preview time, not a re-render');
});

test('discarding a preview and generating a fresh one is a legitimate second render (not a violation) -- but confirming still only reuses the latest', async () => {
  const ORG = 'ORG-RENDER-DISCARD';
  const admin = tokenFor(ORG, 'admin', 'render_discard_admin');
  const UserProfile = require('../models/user_model');
  await UserProfile.create({ username: 'render_discard_recipient', organization_code: ORG, first_name: 'R', last_name: 'One', designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'renderdiscard@example.test', phone: '0', status: 'Active' });
  await seedOrgAndPlan(ORG);

  const designRes = await request(app).post('/api/designs').set('Authorization', `Bearer ${admin}`).send({
    main_template_url: 'https://example.test/t.png', template_url: 'https://example.test/t.png', credential_title: 'Render Discard Template',
    text_attributes: [{ text_title: 'recipient_name', text: 'Name', font_attributes: [{ font_family: 'Georgia', font_size: 24, font_color: '#000', font_weight: 'normal' }], positions: { X: 10, Y: 10 } }],
    QR_CODE: { ecoding_data: 'placeholder', X: 0, Y: 0 },
  });
  const designCode = designRes.body.data.design_code;
  await request(app).post(`/api/designs/${designCode}/publish`).set('Authorization', `Bearer ${admin}`);

  const before = renderRequestCount;

  // First preview -- discarded (Back button, user never confirms it).
  const reserve1 = await request(app).post('/api/credentials/reserve-code').set('Authorization', `Bearer ${admin}`);
  const preview1 = await request(app).post('/api/credentials/generate-certificate').set('Authorization', `Bearer ${admin}`).send({
    design_code: designCode, achiever_username: 'render_discard_recipient', credential_code: reserve1.body.credential_code,
  });
  assert.equal(preview1.status, 201);

  // A fresh preview after discarding -- a real, new reserved code, a real
  // new render. This is correct behavior, not a bug: nothing was ever
  // confirmed for the first one.
  const reserve2 = await request(app).post('/api/credentials/reserve-code').set('Authorization', `Bearer ${admin}`);
  const preview2 = await request(app).post('/api/credentials/generate-certificate').set('Authorization', `Bearer ${admin}`).send({
    design_code: designCode, achiever_username: 'render_discard_recipient', credential_code: reserve2.body.credential_code,
  });
  assert.equal(preview2.status, 201);
  assert.equal(renderRequestCount, before + 2, 'two independent previews are two real renders');

  const confirm2 = await request(app).post('/api/credentials/create').set('Authorization', `Bearer ${admin}`).send({
    credential_pic_url: preview2.body.url, achiever_username: 'render_discard_recipient', credential_code: reserve2.body.credential_code,
  });
  assert.equal(confirm2.status, 201);
  assert.equal(renderRequestCount, before + 2, 'confirming the second preview must not trigger a third render');

  // The first, discarded reservation was never turned into a credential.
  const Credential = require('../models/credentialSchema');
  const orphan = await Credential.findOne({ credential_code: reserve1.body.credential_code }).lean();
  assert.equal(orphan, null, 'a discarded preview must never become an issued credential');
});

test('a render failure during preview leaves nothing issued, and does not silently retry', async () => {
  const ORG = 'ORG-RENDER-FAIL';
  const admin = tokenFor(ORG, 'admin', 'render_fail_admin');
  const UserProfile = require('../models/user_model');
  await UserProfile.create({ username: 'render_fail_recipient', organization_code: ORG, first_name: 'R', last_name: 'One', designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'renderfail@example.test', phone: '0', status: 'Active' });
  await seedOrgAndPlan(ORG);

  const designRes = await request(app).post('/api/designs').set('Authorization', `Bearer ${admin}`).send({
    main_template_url: 'https://example.test/t.png', template_url: 'https://example.test/t.png', credential_title: 'Render Fail Template',
    text_attributes: [{ text_title: 'recipient_name', text: 'Name', font_attributes: [{ font_family: 'Georgia', font_size: 24, font_color: '#000', font_weight: 'normal' }], positions: { X: 10, Y: 10 } }],
    QR_CODE: { ecoding_data: 'placeholder', X: 0, Y: 0 },
  });
  const designCode = designRes.body.data.design_code;
  await request(app).post(`/api/designs/${designCode}/publish`).set('Authorization', `Bearer ${admin}`);

  const reserveRes = await request(app).post('/api/credentials/reserve-code').set('Authorization', `Bearer ${admin}`);
  shouldFailNextRender = true;
  const before = renderRequestCount;

  const previewRes = await request(app).post('/api/credentials/generate-certificate').set('Authorization', `Bearer ${admin}`).send({
    design_code: designCode, achiever_username: 'render_fail_recipient', credential_code: reserveRes.body.credential_code,
  });
  assert.equal(previewRes.status, 502);
  assert.equal(renderRequestCount, before + 1, 'exactly one attempt, no automatic retry');

  const Credential = require('../models/credentialSchema');
  const notIssued = await Credential.findOne({ credential_code: reserveRes.body.credential_code }).lean();
  assert.equal(notIssued, null, 'a failed render must never result in an issued credential');
});

test('generateCertificate (the Preview step) is admin-only -- a non-admin user cannot even trigger a render', async () => {
  const ORG = 'ORG-RENDER-PERMS';
  const nonAdmin = tokenFor(ORG, 'user', 'render_perms_user');
  const before = renderRequestCount;
  const res = await request(app).post('/api/credentials/generate-certificate').set('Authorization', `Bearer ${nonAdmin}`).send({
    design_code: 'DOES-NOT-MATTER', achiever_username: 'whoever', credential_code: 'CRED-0000000000000099',
  });
  assert.equal(res.status, 403);
  assert.equal(renderRequestCount, before, 'a rejected, unauthorized request must never reach the renderer at all');
});

test('createCredential (the Confirm step) rejects re-using an already-issued credential_code -- no duplicate issuance from a double-submit', async () => {
  const ORG = 'ORG-RENDER-DUPLICATE';
  const admin = tokenFor(ORG, 'admin', 'render_dup_admin');
  const UserProfile = require('../models/user_model');
  await UserProfile.create({ username: 'render_dup_recipient', organization_code: ORG, first_name: 'R', last_name: 'One', designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'renderdup@example.test', phone: '0', status: 'Active' });
  await seedOrgAndPlan(ORG);

  const designRes = await request(app).post('/api/designs').set('Authorization', `Bearer ${admin}`).send({
    main_template_url: 'https://example.test/t.png', template_url: 'https://example.test/t.png', credential_title: 'Render Dup Template',
    text_attributes: [{ text_title: 'recipient_name', text: 'Name', font_attributes: [{ font_family: 'Georgia', font_size: 24, font_color: '#000', font_weight: 'normal' }], positions: { X: 10, Y: 10 } }],
    QR_CODE: { ecoding_data: 'placeholder', X: 0, Y: 0 },
  });
  const designCode = designRes.body.data.design_code;
  await request(app).post(`/api/designs/${designCode}/publish`).set('Authorization', `Bearer ${admin}`);

  const reserveRes = await request(app).post('/api/credentials/reserve-code').set('Authorization', `Bearer ${admin}`);
  const previewRes = await request(app).post('/api/credentials/generate-certificate').set('Authorization', `Bearer ${admin}`).send({
    design_code: designCode, achiever_username: 'render_dup_recipient', credential_code: reserveRes.body.credential_code,
  });

  const firstConfirm = await request(app).post('/api/credentials/create').set('Authorization', `Bearer ${admin}`).send({
    credential_pic_url: previewRes.body.url, achiever_username: 'render_dup_recipient', credential_code: reserveRes.body.credential_code,
  });
  assert.equal(firstConfirm.status, 201);

  // A second "Confirm & Issue" click with the exact same reserved code
  // (the button is disabled client-side, but the backend must not trust
  // that -- see the approval-workflow tests for the same principle).
  const secondConfirm = await request(app).post('/api/credentials/create').set('Authorization', `Bearer ${admin}`).send({
    credential_pic_url: previewRes.body.url, achiever_username: 'render_dup_recipient', credential_code: reserveRes.body.credential_code,
  });
  assert.equal(secondConfirm.status, 409);
  assert.match(secondConfirm.body.error || secondConfirm.body.message || '', /already in use/i);

  const Credential = require('../models/credentialSchema');
  const count = await Credential.countDocuments({ credential_code: reserveRes.body.credential_code });
  assert.equal(count, 1, 'exactly one credential must exist, never a duplicate from a double-submit');
});
