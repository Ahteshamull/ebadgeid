// tests/galleryTemplateMaterialization.integration.test.js
//
// Point 8 (Credential Studio closure round): the 12 official gallery
// templates' backgrounds must become real, storage-hosted, Pillow-openable
// PNGs -- not the frontend-hosted SVG URL the design editor used to set
// directly (unreachable by the certificate microservice, and unparseable
// by Pillow even if it were reachable -- see utils/galleryTemplates.js).
// Real HTTP requests against the real Express app (api.js), a real
// MongoDB (mongodb-memory-server); the rasterization itself is real too
// (@resvg/resvg-js, no mock), just written to a temp UPLOAD_DIR instead of
// the real uploads/ folder so this test suite never touches real files.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { GALLERY_TEMPLATE_IDS } = require('../utils/galleryTemplates');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';

let mongod;
let app;
const ORG = 'ORG-GALLERY';
let adminToken;
let nonAdminToken;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  adminToken = jwt.sign({ id: crypto.randomUUID(), username: 'gallery_admin', role: 'admin', organization_code: ORG }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  nonAdminToken = jwt.sign({ id: crypto.randomUUID(), username: 'gallery_user', role: 'user', organization_code: ORG }, process.env.JWT_SECRET, { algorithm: 'HS256' });
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('the registry lists exactly the 12 official gallery template ids', () => {
  assert.equal(GALLERY_TEMPLATE_IDS.length, 12);
  assert.deepEqual([...new Set(GALLERY_TEMPLATE_IDS)], GALLERY_TEMPLATE_IDS, 'no duplicate ids');
});

test('materialize rejects an unauthenticated caller with 401', async () => {
  const res = await request(app).post('/api/designs/gallery-templates/materialize').send({ template_id: 'classic-gold' });
  assert.equal(res.status, 401);
});

test('materialize rejects a non-admin caller with 403', async () => {
  const res = await request(app)
    .post('/api/designs/gallery-templates/materialize')
    .set('Authorization', `Bearer ${nonAdminToken}`)
    .send({ template_id: 'classic-gold' });
  assert.equal(res.status, 403);
});

test('materialize rejects an unknown template_id with 400 -- no arbitrary filesystem access', async () => {
  const res = await request(app)
    .post('/api/designs/gallery-templates/materialize')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ template_id: '../../../etc/passwd' });
  assert.equal(res.status, 400);
});

test('materialize rejects a missing template_id with 400', async () => {
  const res = await request(app)
    .post('/api/designs/gallery-templates/materialize')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({});
  assert.equal(res.status, 400);
});

for (const templateId of GALLERY_TEMPLATE_IDS) {
  test(`materialize produces a real, storage-hosted, Pillow-compatible PNG for "${templateId}"`, async () => {
    const res = await request(app)
      .post('/api/designs/gallery-templates/materialize')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ template_id: templateId });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.data.url, new RegExp(`^${process.env.PUBLIC_STORAGE_BASE_URL}/uploads/gallery-${templateId}-[0-9a-f]{24}\\.png$`));
    assert.equal(res.body.data.width, 900);
    assert.equal(res.body.data.height, 636);

    // Fetch the actual bytes back off disk (UPLOAD_DIR) and verify it's a
    // real, valid PNG of the right dimensions -- not just a URL that
    // happens to look right.
    const filename = res.body.data.url.split('/uploads/')[1];
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'uploads', filename));
    const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE), 'must be a real PNG file, not just named .png');
    // IHDR chunk: width/height are the first 8 bytes after the 8-byte
    // signature + 4-byte length + 4-byte "IHDR" tag, big-endian uint32 each.
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assert.equal(width, 900);
    assert.equal(height, 636);
  });
}

test('materialize is org-independent and stateless -- two different organizations picking the same template each get their own distinct file', async () => {
  const otherOrgToken = jwt.sign({ id: crypto.randomUUID(), username: 'gallery_admin_2', role: 'admin', organization_code: 'ORG-GALLERY-2' }, process.env.JWT_SECRET, { algorithm: 'HS256' });

  const resA = await request(app)
    .post('/api/designs/gallery-templates/materialize')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ template_id: 'star-badge' });
  const resB = await request(app)
    .post('/api/designs/gallery-templates/materialize')
    .set('Authorization', `Bearer ${otherOrgToken}`)
    .send({ template_id: 'star-badge' });

  assert.equal(resA.status, 201);
  assert.equal(resB.status, 201);
  assert.notEqual(resA.body.data.url, resB.body.data.url, 'each materialization must be its own independent file, never shared/cached across organizations');
});

test('a materialized gallery background passes the exact same allowlist check every other design background must pass', async () => {
  const { isAllowedCredentialImage } = require('../controllers/credentialController');
  const res = await request(app)
    .post('/api/designs/gallery-templates/materialize')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ template_id: 'corporate-blue' });
  assert.equal(res.status, 201);
  assert.equal(isAllowedCredentialImage(res.body.data.url), true, 'a materialized gallery background must be indistinguishable from any other real upload to the rest of the system');
});
