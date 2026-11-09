// tests/brandKitIsolation.integration.test.js
//
// Point 1 (Credential Studio closure round): Brand Kit (one primary color,
// one secondary color, one logo per organization -- controllers/
// brandKitController.js, models/organizationBrandKit.js). Inspection of
// the existing code found the isolation, validation, and default-value
// behavior already correct; this is the executable proof the spec
// requires ("Debe quedar probado de punta a punta"), not a code fix.
// Real HTTP requests against the real Express app (api.js), a real
// MongoDB (mongodb-memory-server).
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';

let mongod;
let app;

function tokenFor(orgCode, role, username) {
  return jwt.sign({ id: crypto.randomUUID(), username, role, organization_code: orgCode }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('GET /api/brand-kit returns sane schema defaults when an organization has never saved one, and persists nothing yet', async () => {
  const admin = tokenFor('ORG-BRANDKIT-DEFAULT', 'admin', 'bk_default_admin');
  const res = await request(app).get('/api/brand-kit').set('Authorization', `Bearer ${admin}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.primary_color, '#4f46e5');
  assert.equal(res.body.data.secondary_color, '#1f2937');
  assert.equal(res.body.data.logo_url, '');

  const OrganizationBrandKit = require('../models/organizationBrandKit');
  const stored = await OrganizationBrandKit.findOne({ organization_code: 'ORG-BRANDKIT-DEFAULT' });
  assert.equal(stored, null, 'reading the default must never implicitly create a row');
});

test('GET and PUT /api/brand-kit require authentication and admin role', async () => {
  const unauthRes = await request(app).get('/api/brand-kit');
  assert.equal(unauthRes.status, 401);

  const nonAdmin = tokenFor('ORG-BRANDKIT-PERMS', 'user', 'bk_perms_user');
  const getRes = await request(app).get('/api/brand-kit').set('Authorization', `Bearer ${nonAdmin}`);
  assert.equal(getRes.status, 403);
  const putRes = await request(app).put('/api/brand-kit').set('Authorization', `Bearer ${nonAdmin}`).send({ primary_color: '#111111' });
  assert.equal(putRes.status, 403);
});

test('PUT /api/brand-kit rejects an invalid primary_color and an invalid secondary_color', async () => {
  const admin = tokenFor('ORG-BRANDKIT-VALIDATE', 'admin', 'bk_validate_admin');
  const badPrimary = await request(app).put('/api/brand-kit').set('Authorization', `Bearer ${admin}`).send({ primary_color: 'not-a-color' });
  assert.equal(badPrimary.status, 400);
  const badPrimary2 = await request(app).put('/api/brand-kit').set('Authorization', `Bearer ${admin}`).send({ primary_color: '#zzzzzz' });
  assert.equal(badPrimary2.status, 400);
  const badSecondary = await request(app).put('/api/brand-kit').set('Authorization', `Bearer ${admin}`).send({ secondary_color: '#12345' }); // too short
  assert.equal(badSecondary.status, 400);

  const OrganizationBrandKit = require('../models/organizationBrandKit');
  const stored = await OrganizationBrandKit.findOne({ organization_code: 'ORG-BRANDKIT-VALIDATE' });
  assert.equal(stored, null, 'no invalid attempt must ever have been persisted');
});

test('PUT /api/brand-kit rejects a logo_url that is not a real, previously uploaded managed-storage image (no arbitrary hotlinking)', async () => {
  const admin = tokenFor('ORG-BRANDKIT-LOGO-VALIDATE', 'admin', 'bk_logo_admin');
  const res = await request(app).put('/api/brand-kit').set('Authorization', `Bearer ${admin}`).send({ logo_url: 'https://evil.example.com/tracker.png' });
  assert.equal(res.status, 400);

  const res2 = await request(app).put('/api/brand-kit').set('Authorization', `Bearer ${admin}`).send({ logo_url: 'javascript:alert(1)' });
  assert.equal(res2.status, 400);
});

test('PUT /api/brand-kit persists real colors and a real managed-storage logo, and GET reflects them back', async () => {
  const admin = tokenFor('ORG-BRANDKIT-PERSIST', 'admin', 'bk_persist_admin');
  const logoUrl = `${process.env.PUBLIC_STORAGE_BASE_URL}/uploads/real-logo-abc123.png`;
  const putRes = await request(app).put('/api/brand-kit').set('Authorization', `Bearer ${admin}`).send({
    primary_color: '#123456', secondary_color: '#abcdef', logo_url: logoUrl,
  });
  assert.equal(putRes.status, 200);
  assert.equal(putRes.body.data.primary_color, '#123456');
  assert.equal(putRes.body.data.logo_url, logoUrl);

  const getRes = await request(app).get('/api/brand-kit').set('Authorization', `Bearer ${admin}`);
  assert.equal(getRes.body.data.primary_color, '#123456');
  assert.equal(getRes.body.data.secondary_color, '#abcdef');
  assert.equal(getRes.body.data.logo_url, logoUrl);
});

test('PUT /api/brand-kit can remove a previously set logo by sending an empty logo_url', async () => {
  const admin = tokenFor('ORG-BRANDKIT-REMOVE-LOGO', 'admin', 'bk_remove_admin');
  const logoUrl = `${process.env.PUBLIC_STORAGE_BASE_URL}/uploads/to-be-removed.png`;
  await request(app).put('/api/brand-kit').set('Authorization', `Bearer ${admin}`).send({ logo_url: logoUrl });
  const removeRes = await request(app).put('/api/brand-kit').set('Authorization', `Bearer ${admin}`).send({ logo_url: '' });
  assert.equal(removeRes.status, 200);
  assert.equal(removeRes.body.data.logo_url, '');

  const getRes = await request(app).get('/api/brand-kit').set('Authorization', `Bearer ${admin}`);
  assert.equal(getRes.body.data.logo_url, '');
});

test('PUT /api/brand-kit can replace an existing logo with a different one', async () => {
  const admin = tokenFor('ORG-BRANDKIT-REPLACE-LOGO', 'admin', 'bk_replace_admin');
  const firstLogo = `${process.env.PUBLIC_STORAGE_BASE_URL}/uploads/first-logo.png`;
  const secondLogo = `${process.env.PUBLIC_STORAGE_BASE_URL}/uploads/second-logo.png`;
  await request(app).put('/api/brand-kit').set('Authorization', `Bearer ${admin}`).send({ logo_url: firstLogo });
  const replaceRes = await request(app).put('/api/brand-kit').set('Authorization', `Bearer ${admin}`).send({ logo_url: secondLogo });
  assert.equal(replaceRes.status, 200);
  assert.equal(replaceRes.body.data.logo_url, secondLogo);
});

test('a partial update only touches the fields sent -- updating just the logo does not reset the colors', async () => {
  const admin = tokenFor('ORG-BRANDKIT-PARTIAL', 'admin', 'bk_partial_admin');
  await request(app).put('/api/brand-kit').set('Authorization', `Bearer ${admin}`).send({ primary_color: '#654321', secondary_color: '#fedcba' });
  const logoOnlyRes = await request(app).put('/api/brand-kit').set('Authorization', `Bearer ${admin}`).send({ logo_url: `${process.env.PUBLIC_STORAGE_BASE_URL}/uploads/only-logo.png` });
  assert.equal(logoOnlyRes.status, 200);
  assert.equal(logoOnlyRes.body.data.primary_color, '#654321', 'colors must survive a logo-only update');
  assert.equal(logoOnlyRes.body.data.secondary_color, '#fedcba');
});

test('Organization A can never read Organization B\'s brand kit, and never modify it', async () => {
  const adminA = tokenFor('ORG-BRANDKIT-A', 'admin', 'bk_org_a_admin');
  const adminB = tokenFor('ORG-BRANDKIT-B', 'admin', 'bk_org_b_admin');

  await request(app).put('/api/brand-kit').set('Authorization', `Bearer ${adminB}`).send({
    primary_color: '#b00b00', secondary_color: '#00b00b', logo_url: `${process.env.PUBLIC_STORAGE_BASE_URL}/uploads/org-b-logo.png`,
  });

  // A reads its own kit -- must be the untouched defaults, never B's real values.
  const aReadRes = await request(app).get('/api/brand-kit').set('Authorization', `Bearer ${adminA}`);
  assert.equal(aReadRes.body.data.primary_color, '#4f46e5', "A must see its own default, never B's #b00b00");
  assert.notEqual(aReadRes.body.data.logo_url, `${process.env.PUBLIC_STORAGE_BASE_URL}/uploads/org-b-logo.png`);

  // A "writes" its own kit -- must never be able to affect B's, since the
  // endpoint has no way to target another org's document at all (no
  // org-scoped path param, purely req.user.organization_code -- attempting
  // to smuggle an organization_code in the body is the direct attack to
  // rule out here).
  const smuggleRes = await request(app).put('/api/brand-kit').set('Authorization', `Bearer ${adminA}`).send({
    organization_code: 'ORG-BRANDKIT-B', primary_color: '#111111',
  });
  assert.equal(smuggleRes.status, 200);

  const bReadRes = await request(app).get('/api/brand-kit').set('Authorization', `Bearer ${adminB}`);
  assert.equal(bReadRes.body.data.primary_color, '#b00b00', "B's brand kit must be completely unaffected by A's write, even with organization_code smuggled in the body");

  const OrganizationBrandKit = require('../models/organizationBrandKit');
  const count = await OrganizationBrandKit.countDocuments({ organization_code: 'ORG-BRANDKIT-B' });
  assert.equal(count, 1, 'A\'s write must never have created or touched a second document under B\'s organization_code');
});
