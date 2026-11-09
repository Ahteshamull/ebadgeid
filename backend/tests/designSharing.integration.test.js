// tests/designSharing.integration.test.js
//
// Cross-organization template sharing (routes/designShareRoutes.js,
// controllers/designShareController.js) -- distinct from the public "Share
// on LinkedIn" preview (see tests/designPublishing.integration.test.js's
// getPublicDesignPreview coverage). A share grants visibility; importing it
// creates a real, independent, editable copy owned by the receiving org,
// never a live link back to the source. Real HTTP requests against the
// real Express app (api.js), a real MongoDB (mongodb-memory-server).
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

const SOURCE_ORG = 'ORG-SHARE-SOURCE';
const TARGET_ORG = 'ORG-SHARE-TARGET';
const OUTSIDER_ORG = 'ORG-SHARE-OUTSIDER';
let sourceAdmin;
let targetAdmin;
let outsiderAdmin;
let shareId;

function tokenFor(orgCode, role, username) {
  return jwt.sign({ id: crypto.randomUUID(), username, role, organization_code: orgCode }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  sourceAdmin = tokenFor(SOURCE_ORG, 'admin', 'share_source_admin');
  targetAdmin = tokenFor(TARGET_ORG, 'admin', 'share_target_admin');
  outsiderAdmin = tokenFor(OUTSIDER_ORG, 'admin', 'share_outsider_admin');

  const Organization = require('../models/organization_schema');
  await Organization.create([
    { organization_code: SOURCE_ORG, name: 'Share Source Org', city: 'C', state: 'S', country: 'PY', email: 'sharesource@example.test', phone: '0', status: 'ACTIVE', plan: 'Free' },
    { organization_code: TARGET_ORG, name: 'Share Target Org', city: 'C', state: 'S', country: 'PY', email: 'sharetarget@example.test', phone: '0', status: 'ACTIVE', plan: 'Free' },
  ]);

  await request(app)
    .post('/api/designs')
    .set('Authorization', `Bearer ${sourceAdmin}`)
    .send({
      design_code: 'DESIGN-SHARE-001',
      main_template_url: 'https://example.test/t.png',
      template_url: 'https://example.test/t.png',
      credential_title: 'Shareable Template',
      text_attributes: [{ text_title: 'recipient_name', text: 'Name', font_attributes: [{ font_family: 'Georgia', font_size: 24, font_color: '#000000', font_weight: 'normal' }], positions: { X: 10, Y: 10 } }],
      QR_CODE: { ecoding_data: 'placeholder', X: 0, Y: 0 },
    });
  await request(app).post('/api/designs/DESIGN-SHARE-001/publish').set('Authorization', `Bearer ${sourceAdmin}`);
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('shareDesign rejects sharing with your own organization', async () => {
  const res = await request(app)
    .post('/api/design-shares')
    .set('Authorization', `Bearer ${sourceAdmin}`)
    .send({ design_code: 'DESIGN-SHARE-001', target_organization_code: SOURCE_ORG });
  assert.equal(res.status, 400);
});

test('shareDesign rejects sharing a template you do not own with 403', async () => {
  const res = await request(app)
    .post('/api/design-shares')
    .set('Authorization', `Bearer ${outsiderAdmin}`)
    .send({ design_code: 'DESIGN-SHARE-001', target_organization_code: TARGET_ORG });
  assert.equal(res.status, 403);
});

test('shareDesign rejects an unknown target organization with 404', async () => {
  const res = await request(app)
    .post('/api/design-shares')
    .set('Authorization', `Bearer ${sourceAdmin}`)
    .send({ design_code: 'DESIGN-SHARE-001', target_organization_code: 'ORG-DOES-NOT-EXIST' });
  assert.equal(res.status, 404);
});

test('shareDesign succeeds for the real owner sharing with a real target org', async () => {
  const res = await request(app)
    .post('/api/design-shares')
    .set('Authorization', `Bearer ${sourceAdmin}`)
    .send({ design_code: 'DESIGN-SHARE-001', target_organization_code: TARGET_ORG });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.design_code, 'DESIGN-SHARE-001');
  assert.equal(res.body.data.target_organization_code, TARGET_ORG);
  shareId = res.body.data._id;
});

test('sharing the same template with the same org twice is idempotent, not a duplicate row', async () => {
  const res = await request(app)
    .post('/api/design-shares')
    .set('Authorization', `Bearer ${sourceAdmin}`)
    .send({ design_code: 'DESIGN-SHARE-001', target_organization_code: TARGET_ORG });
  assert.equal(res.status, 201);
  assert.equal(res.body.data._id, shareId);

  const DesignShare = require('../models/designShare');
  const count = await DesignShare.countDocuments({ design_code: 'DESIGN-SHARE-001', target_organization_code: TARGET_ORG });
  assert.equal(count, 1);
});

test('an outsider organization sees nothing in "shared with me"', async () => {
  const res = await request(app).get('/api/design-shares/received').set('Authorization', `Bearer ${outsiderAdmin}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, []);
});

test('the target organization sees the share, with source org name and design preview joined in', async () => {
  const res = await request(app).get('/api/design-shares/received').set('Authorization', `Bearer ${targetAdmin}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].design_code, 'DESIGN-SHARE-001');
  assert.equal(res.body.data[0].source_organization_name, 'Share Source Org');
  assert.equal(res.body.data[0].design.credential_title, 'Shareable Template');
});

test('the source organization sees its own outgoing share in "shared by me"', async () => {
  const res = await request(app).get('/api/design-shares/sent').set('Authorization', `Bearer ${sourceAdmin}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].target_organization_code, TARGET_ORG);
});

test('importSharedDesign rejects an organization the template was not shared with, with 403', async () => {
  const res = await request(app).post(`/api/design-shares/${shareId}/import`).set('Authorization', `Bearer ${outsiderAdmin}`);
  assert.equal(res.status, 403);
});

test('importSharedDesign creates a real, independent draft copy owned by the target org', async () => {
  const res = await request(app).post(`/api/design-shares/${shareId}/import`).set('Authorization', `Bearer ${targetAdmin}`);
  assert.equal(res.status, 201);
  const imported = res.body.data;
  assert.notEqual(imported.design_code, 'DESIGN-SHARE-001', 'must get its own new design_code, not reuse the source one');
  assert.equal(imported.organization_code, TARGET_ORG);
  assert.equal(imported.status, 'draft', 'must never come in already published, regardless of the source status');
  assert.equal(imported.text_attributes[0].text_title, 'recipient_name', 'visual content must be copied over');

  const Design = require('../models/designSchema');
  const original = await Design.findOne({ design_code: 'DESIGN-SHARE-001' }).lean();
  assert.equal(original.status, 'published', 'importing a copy must never mutate the source design');
  assert.equal(original.organization_code, SOURCE_ORG);
});

test('revokeShare rejects the receiving organization -- only the source org can revoke its own share', async () => {
  const res = await request(app).delete(`/api/design-shares/${shareId}`).set('Authorization', `Bearer ${targetAdmin}`);
  assert.equal(res.status, 403);
});

test('revokeShare lets the source org revoke it, and it disappears from "shared with me"', async () => {
  const revokeRes = await request(app).delete(`/api/design-shares/${shareId}`).set('Authorization', `Bearer ${sourceAdmin}`);
  assert.equal(revokeRes.status, 200);

  const listRes = await request(app).get('/api/design-shares/received').set('Authorization', `Bearer ${targetAdmin}`);
  assert.deepEqual(listRes.body.data, []);
});
