// tests/designArchiveDuplicate.integration.test.js
//
// Archive/Unarchive/Duplicate for templates -- part of the Credential
// Studio work extending the Draft/Published status from
// tests/designPublishing.integration.test.js with a third state
// ('archived') plus a way to clone a template's full content. Real HTTP
// requests against the real Express app (api.js) and a real MongoDB
// (mongodb-memory-server).
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

const ORG_A = 'ORG-ARCH-A';
const ORG_B = 'ORG-ARCH-B';
let adminA;
let adminB;

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
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const DESIGN_PAYLOAD = {
  main_template_url: 'https://example.test/t.png',
  template_url: 'https://example.test/t.png',
  credential_title: 'Archive Test Template',
  text_attributes: [{ text_title: 'recipient_name', text: 'Name', font_attributes: [{ font_family: 'Georgia', font_size: 24, font_color: '#000', font_weight: 'normal' }], positions: { X: 10, Y: 10 } }],
  QR_CODE: { ecoding_data: 'placeholder', X: 0, Y: 0 },
};

test('archiveDesign sets status to archived, and generateCertificate then rejects issuing from it with 409', async () => {
  const createRes = await request(app)
    .post('/api/designs')
    .set('Authorization', `Bearer ${adminA}`)
    .send({ ...DESIGN_PAYLOAD, design_code: 'DESIGN-ARCH-001' });
  assert.equal(createRes.status, 201);

  // Publish first -- otherwise "still a draft" and "archived" are both 409
  // and this test wouldn't actually prove archiving is what did it.
  await request(app).post('/api/designs/DESIGN-ARCH-001/publish').set('Authorization', `Bearer ${adminA}`);

  const archiveRes = await request(app)
    .post('/api/designs/DESIGN-ARCH-001/archive')
    .set('Authorization', `Bearer ${adminA}`);
  assert.equal(archiveRes.status, 200);
  assert.equal(archiveRes.body.data.status, 'archived');

  const UserProfile = require('../models/user_model');
  await UserProfile.create({
    username: 'arch_recipient_1', organization_code: ORG_A, first_name: 'R', last_name: 'One',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'archrecipient1@example.test', phone: '0', status: 'Active',
  });
  const certRes = await request(app)
    .post('/api/credentials/generate-certificate')
    .set('Authorization', `Bearer ${adminA}`)
    .send({ design_code: 'DESIGN-ARCH-001', achiever_username: 'arch_recipient_1', credential_code: 'CRED-1000000000000001' });
  assert.equal(certRes.status, 409);
  assert.match(certRes.body.message, /archived/i);
});

test('unarchiveDesign restores an archived template to draft, not published', async () => {
  const res = await request(app)
    .post('/api/designs/DESIGN-ARCH-001/unarchive')
    .set('Authorization', `Bearer ${adminA}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'draft');
});

test('archive/unarchive reject a non-admin and a different organization\'s admin', async () => {
  const nonAdminA = tokenFor(ORG_A, 'user');
  const nonAdminRes = await request(app).post('/api/designs/DESIGN-ARCH-001/archive').set('Authorization', `Bearer ${nonAdminA}`);
  assert.equal(nonAdminRes.status, 403);

  const crossOrgRes = await request(app).post('/api/designs/DESIGN-ARCH-001/archive').set('Authorization', `Bearer ${adminB}`);
  assert.equal(crossOrgRes.status, 403);
});

test('GET /designs/organization/:code excludes archived templates by default, and includes them with ?include_archived=true', async () => {
  await request(app).post('/api/designs/DESIGN-ARCH-001/archive').set('Authorization', `Bearer ${adminA}`);

  const defaultRes = await request(app)
    .get(`/api/designs/organization/${ORG_A}`)
    .set('Authorization', `Bearer ${adminA}`);
  assert.equal(defaultRes.status, 200);
  assert.ok(!defaultRes.body.data.some((d) => d.design_code === 'DESIGN-ARCH-001'), 'archived template must not appear by default');

  const includeRes = await request(app)
    .get(`/api/designs/organization/${ORG_A}?include_archived=true`)
    .set('Authorization', `Bearer ${adminA}`);
  assert.equal(includeRes.status, 200);
  assert.ok(includeRes.body.data.some((d) => d.design_code === 'DESIGN-ARCH-001'), 'archived template must appear when explicitly requested');
});

test('duplicateDesign clones the full content into a new draft template, and rejects cross-org/non-admin', async () => {
  const createRes = await request(app)
    .post('/api/designs')
    .set('Authorization', `Bearer ${adminA}`)
    .send({ ...DESIGN_PAYLOAD, design_code: 'DESIGN-DUP-SOURCE', credential_title: 'Source Template' });
  assert.equal(createRes.status, 201);
  await request(app).post('/api/designs/DESIGN-DUP-SOURCE/publish').set('Authorization', `Bearer ${adminA}`);

  const nonAdminA = tokenFor(ORG_A, 'user');
  const nonAdminRes = await request(app).post('/api/designs/DESIGN-DUP-SOURCE/duplicate').set('Authorization', `Bearer ${nonAdminA}`);
  assert.equal(nonAdminRes.status, 403);

  const crossOrgRes = await request(app).post('/api/designs/DESIGN-DUP-SOURCE/duplicate').set('Authorization', `Bearer ${adminB}`);
  assert.equal(crossOrgRes.status, 403);

  const dupRes = await request(app)
    .post('/api/designs/DESIGN-DUP-SOURCE/duplicate')
    .set('Authorization', `Bearer ${adminA}`);
  assert.equal(dupRes.status, 201);
  const copy = dupRes.body.data;
  assert.notEqual(copy.design_code, 'DESIGN-DUP-SOURCE', 'the duplicate must get its own new design_code');
  assert.equal(copy.credential_title, 'Source Template (copy)');
  assert.equal(copy.status, 'draft', 'a duplicate of a published template must start as draft, not immediately issuable');
  assert.equal(copy.current_version, 1);
  assert.equal(copy.text_attributes.length, 1);
  assert.equal(copy.text_attributes[0].text_title, 'recipient_name');
  assert.equal(copy.main_template_url, DESIGN_PAYLOAD.main_template_url);

  // The source itself must be completely untouched by duplicating it.
  const sourceRes = await request(app)
    .get('/api/designs/by-code/DESIGN-DUP-SOURCE')
    .set('Authorization', `Bearer ${adminA}`);
  assert.equal(sourceRes.body.status, 'published');
  assert.equal(sourceRes.body.credential_title, 'Source Template');
});
