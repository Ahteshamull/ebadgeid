// tests/designPublishing.integration.test.js
//
// Draft/Published status gate + the public template preview it backs (see
// AUDIT_FIXES.md, "Ronda 33" -- prior to this, any saved template, finished
// or not, was immediately usable to issue credentials, with no way to tell
// the two apart). Real HTTP requests against the real Express app (api.js),
// a real MongoDB (mongodb-memory-server).
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';
process.env.CERTIFICATE_SERVICE_URL = process.env.CERTIFICATE_SERVICE_URL || 'http://localhost:8100';
process.env.CERTIFICATE_INTERNAL_KEY = process.env.CERTIFICATE_INTERNAL_KEY || 'test-internal-key';

let mongod;
let app;

const ORG_A = 'ORG-PUB-A';
const ORG_B = 'ORG-PUB-B';
let adminA;
let adminB;
let nonAdminA;

function tokenFor(orgCode, role = 'admin', username) {
  return jwt.sign(
    { id: crypto.randomUUID(), username: username || `user_${orgCode}_${role}`, role, organization_code: orgCode },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' }
  );
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  adminA = tokenFor(ORG_A, 'admin');
  adminB = tokenFor(ORG_B, 'admin');
  nonAdminA = tokenFor(ORG_A, 'user');
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const DESIGN_PAYLOAD = {
  main_template_url: 'https://example.test/t.png',
  template_url: 'https://example.test/t.png',
  credential_title: 'Publishing Test Template',
  text_attributes: [{ text_title: 'recipient_name', text: 'Name', font_attributes: [{ font_family: 'Georgia', font_size: 24, font_color: '#000', font_weight: 'normal' }], positions: { X: 10, Y: 10 } }],
  QR_CODE: { ecoding_data: 'placeholder', X: 0, Y: 0 },
};

test('createDesign always saves a brand-new template as draft, even if the client sends status: published', async () => {
  const res = await request(app)
    .post('/api/designs')
    .set('Authorization', `Bearer ${adminA}`)
    .send({ ...DESIGN_PAYLOAD, design_code: 'DESIGN-PUB-001', status: 'published' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.status, 'draft');
});

test('generateCertificate rejects issuing from a draft template with 409 and a clear message', async () => {
  const UserProfile = require('../models/user_model');
  await UserProfile.create({
    username: 'pub_recipient_1', organization_code: ORG_A, first_name: 'R', last_name: 'One',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'pubrecipient1@example.test', phone: '0', status: 'Active',
  });
  const res = await request(app)
    .post('/api/credentials/generate-certificate')
    .set('Authorization', `Bearer ${adminA}`)
    .send({ design_code: 'DESIGN-PUB-001', achiever_username: 'pub_recipient_1', credential_code: 'CRED-0000000000000002' });
  assert.equal(res.status, 409);
  assert.match(res.body.message, /draft/i);
});

test('publishDesign rejects a non-admin caller with 403', async () => {
  const res = await request(app)
    .post('/api/designs/DESIGN-PUB-001/publish')
    .set('Authorization', `Bearer ${nonAdminA}`);
  assert.equal(res.status, 403);
});

test('publishDesign rejects an admin from a different organization with 403', async () => {
  const res = await request(app)
    .post('/api/designs/DESIGN-PUB-001/publish')
    .set('Authorization', `Bearer ${adminB}`);
  assert.equal(res.status, 403);
});

test('publishDesign marks the template published, and generateCertificate no longer blocks on the draft gate', async () => {
  const publishRes = await request(app)
    .post('/api/designs/DESIGN-PUB-001/publish')
    .set('Authorization', `Bearer ${adminA}`);
  assert.equal(publishRes.status, 200);
  assert.equal(publishRes.body.data.status, 'published');

  const certRes = await request(app)
    .post('/api/credentials/generate-certificate')
    .set('Authorization', `Bearer ${adminA}`)
    .send({ design_code: 'DESIGN-PUB-001', achiever_username: 'pub_recipient_1', credential_code: 'CRED-0000000000000003' });
  // No certificate microservice is reachable in the standard `npm test` run
  // (see tests/lmsSync.integration.test.js's identical documented
  // limitation), so this can't reach 201 here -- what matters for this
  // gate is that it's no longer the 409 draft rejection.
  assert.notEqual(certRes.status, 409);
  assert.doesNotMatch(certRes.body.message || '', /draft/i);
});

test('unpublishDesign reverts a template to draft, and generateCertificate blocks again', async () => {
  const unpublishRes = await request(app)
    .post('/api/designs/DESIGN-PUB-001/unpublish')
    .set('Authorization', `Bearer ${adminA}`);
  assert.equal(unpublishRes.status, 200);
  assert.equal(unpublishRes.body.data.status, 'draft');

  const certRes = await request(app)
    .post('/api/credentials/generate-certificate')
    .set('Authorization', `Bearer ${adminA}`)
    .send({ design_code: 'DESIGN-PUB-001', achiever_username: 'pub_recipient_1', credential_code: 'CRED-0000000000000004' });
  assert.equal(certRes.status, 409);
});

test('a template saved before the status field existed (no stored status at all) is treated as published, not blocked', async () => {
  // Bypasses Mongoose document construction on purpose -- inserting through
  // the raw driver, not Design.create(), is the only way to reproduce a
  // document with no `status` key at all (Design.create() would apply the
  // schema's own default at hydration time, masking exactly the gap this
  // test exists to catch). This is what every design saved before this
  // feature actually looks like in the real database.
  const Design = require('../models/designSchema');
  await Design.collection.insertOne({
    organization_code: ORG_A, design_code: 'DESIGN-PUB-LEGACY-001',
    main_template_url: 'https://example.test/legacy.png', template_url: 'https://example.test/legacy.png',
    text_attributes: DESIGN_PAYLOAD.text_attributes, QR_CODE: DESIGN_PAYLOAD.QR_CODE,
    current_version: 1,
  });
  const raw = await Design.collection.findOne({ design_code: 'DESIGN-PUB-LEGACY-001' });
  assert.equal(raw.status, undefined, 'sanity check: this document really has no status field');

  const certRes = await request(app)
    .post('/api/credentials/generate-certificate')
    .set('Authorization', `Bearer ${adminA}`)
    .send({ design_code: 'DESIGN-PUB-LEGACY-001', achiever_username: 'pub_recipient_1', credential_code: 'CRED-0000000000000005' });
  assert.notEqual(certRes.status, 409, 'a pre-existing template with no status field must never become retroactively unissuable');
});

test('the backfill migration sets status: published on that same legacy document, and it is idempotent', async () => {
  const { migrations } = require('../scripts/migrate');
  const migration = migrations.find((m) => m.id === '20260821_backfill_design_status_published');
  assert.ok(migration, 'migration must still be registered');
  const db = mongoose.connection.db;

  const firstRun = await migration.run(db);
  assert.equal(firstRun.migrated, 1);

  const Design = require('../models/designSchema');
  const updated = await Design.collection.findOne({ design_code: 'DESIGN-PUB-LEGACY-001' });
  assert.equal(updated.status, 'published');

  const secondRun = await migration.run(db);
  assert.equal(secondRun.migrated, 0, 'running it again must not touch anything -- nothing left with a missing status');
});

test('getPublicDesignPreview 404s for a draft template (same response shape as "does not exist", so drafts stay unguessable)', async () => {
  await request(app)
    .post('/api/designs/DESIGN-PUB-001/unpublish')
    .set('Authorization', `Bearer ${adminA}`);
  const res = await request(app).get('/api/designs/public/DESIGN-PUB-001');
  assert.equal(res.status, 404);
});

test('getPublicDesignPreview 404s for a design_code that does not exist at all', async () => {
  const res = await request(app).get('/api/designs/public/DESIGN-PUB-DOES-NOT-EXIST');
  assert.equal(res.status, 404);
});

test('getPublicDesignPreview returns the public fields (with organization_name) for a published template, and never leaks organization_code', async () => {
  await request(app)
    .post('/api/designs/DESIGN-PUB-001/publish')
    .set('Authorization', `Bearer ${adminA}`);
  const Organization = require('../models/organization_schema');
  await Organization.create({
    organization_code: ORG_A, name: 'Publishing Test Org', city: 'C', state: 'S', country: 'PY',
    email: 'pubtestorg@example.test', phone: '0', status: 'ACTIVE', plan: 'Free',
  });

  const res = await request(app).get('/api/designs/public/DESIGN-PUB-001');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.design_code, 'DESIGN-PUB-001');
  assert.equal(res.body.data.credential_title, 'Publishing Test Template');
  assert.equal(res.body.data.organization_name, 'Publishing Test Org');
  assert.equal(res.body.data.organization_code, undefined, 'the public route must never expose the raw organization_code');
});

test('getPublicDesignPreview requires no authentication at all', async () => {
  const res = await request(app).get('/api/designs/public/DESIGN-PUB-001');
  assert.notEqual(res.status, 401);
});
