// tests/designSharingDivergenceAndAttacks.integration.test.js
//
// Point 7 (Credential Studio closure round): extends the existing
// tests/designSharing.integration.test.js coverage with the specific
// scenarios the spec calls out that weren't yet proven by an executable
// test -- post-import divergence in both directions, an unrelated third
// organization attacking the share, a nonexistent design/share_id, and a
// non-admin caller. Inspection of designShareController.js found the
// underlying implementation already correct (importSharedDesign builds a
// brand-new Design document via .toObject(), never a reference) -- this is
// the real proof, not a code fix.
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
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';

let mongod;
let app;

function tokenFor(orgCode, role, username) {
  return jwt.sign({ id: crypto.randomUUID(), username, role, organization_code: orgCode }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

const DESIGN_PAYLOAD = (title) => ({
  main_template_url: 'https://example.test/t.png',
  template_url: 'https://example.test/t.png',
  credential_title: title,
  text_attributes: [{ text_title: 'recipient_name', text: 'Name', font_attributes: [{ font_family: 'Georgia', font_size: 24, font_color: '#000000', font_weight: 'normal' }], positions: { X: 10, Y: 10 } }],
  QR_CODE: { ecoding_data: 'placeholder', X: 0, Y: 0 },
});

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('post-import divergence: A modifying the original after sharing does not change B\'s already-imported copy, and B modifying its copy does not change A\'s original', async () => {
  const ORG_A = 'ORG-DIVERGE-A';
  const ORG_B = 'ORG-DIVERGE-B';
  const adminA = tokenFor(ORG_A, 'admin', 'diverge_admin_a');
  const adminB = tokenFor(ORG_B, 'admin', 'diverge_admin_b');

  const Organization = require('../models/organization_schema');
  await Organization.create({ organization_code: ORG_B, name: 'Diverge Org B', city: 'C', state: 'S', country: 'PY', email: 'divergeb@example.test', phone: '0', status: 'ACTIVE', plan: 'Free' });

  const createRes = await request(app).post('/api/designs').set('Authorization', `Bearer ${adminA}`).send(DESIGN_PAYLOAD('Original Title'));
  const originalCode = createRes.body.data.design_code;
  await request(app).post(`/api/designs/${originalCode}/publish`).set('Authorization', `Bearer ${adminA}`);

  const shareRes = await request(app).post('/api/design-shares').set('Authorization', `Bearer ${adminA}`).send({ design_code: originalCode, target_organization_code: ORG_B });
  const shareId = shareRes.body.data._id;
  const importRes = await request(app).post(`/api/design-shares/${shareId}/import`).set('Authorization', `Bearer ${adminB}`);
  const importedCode = importRes.body.data.design_code;
  assert.notEqual(importedCode, originalCode);

  // A modifies the original AFTER the import already happened.
  await request(app).put(`/api/designs/${originalCode}`).set('Authorization', `Bearer ${adminA}`).send({ credential_title: 'A changed this after sharing', known_version: createRes.body.data.current_version });

  const bCopyAfterAEdit = await request(app).get(`/api/designs/by-code/${importedCode}`).set('Authorization', `Bearer ${adminB}`);
  assert.equal(bCopyAfterAEdit.body.credential_title, 'Original Title (shared)', 'B\'s copy must be completely unaffected by A\'s later edit to the original');

  // B modifies its own copy.
  await request(app).put(`/api/designs/${importedCode}`).set('Authorization', `Bearer ${adminB}`).send({ credential_title: 'B changed its own copy', known_version: importRes.body.data.current_version });

  const aOriginalAfterBEdit = await request(app).get(`/api/designs/by-code/${originalCode}`).set('Authorization', `Bearer ${adminA}`);
  assert.equal(aOriginalAfterBEdit.body.credential_title, 'A changed this after sharing', 'A\'s original must be completely unaffected by B\'s edit to its own copy');
});

test('sharing a design_code that does not exist at all returns 404, not 500 or a silent share record', async () => {
  const adminA = tokenFor('ORG-DIVERGE-NOTEMPLATE', 'admin', 'notemplate_admin');
  const Organization = require('../models/organization_schema');
  await Organization.create({ organization_code: 'ORG-DIVERGE-NOTEMPLATE-TARGET', name: 'Target', city: 'C', state: 'S', country: 'PY', email: 'notemplatetarget@example.test', phone: '0', status: 'ACTIVE', plan: 'Free' });
  const res = await request(app).post('/api/design-shares').set('Authorization', `Bearer ${adminA}`).send({ design_code: 'DESIGN-DOES-NOT-EXIST-AT-ALL', target_organization_code: 'ORG-DIVERGE-NOTEMPLATE-TARGET' });
  assert.equal(res.status, 404);

  const DesignShare = require('../models/designShare');
  const count = await DesignShare.countDocuments({ design_code: 'DESIGN-DOES-NOT-EXIST-AT-ALL' });
  assert.equal(count, 0);
});

test('a non-admin user cannot share, list, revoke, or import -- every design-shares route requires admin', async () => {
  const ORG = 'ORG-DIVERGE-NONADMIN';
  const nonAdmin = tokenFor(ORG, 'user', 'diverge_nonadmin');
  const shareRes = await request(app).post('/api/design-shares').set('Authorization', `Bearer ${nonAdmin}`).send({ design_code: 'X', target_organization_code: 'Y' });
  assert.equal(shareRes.status, 403);
  const receivedRes = await request(app).get('/api/design-shares/received').set('Authorization', `Bearer ${nonAdmin}`);
  assert.equal(receivedRes.status, 403);
  const sentRes = await request(app).get('/api/design-shares/sent').set('Authorization', `Bearer ${nonAdmin}`);
  assert.equal(sentRes.status, 403);
  const revokeRes = await request(app).delete('/api/design-shares/000000000000000000000000').set('Authorization', `Bearer ${nonAdmin}`);
  assert.equal(revokeRes.status, 403);
  const importRes = await request(app).post('/api/design-shares/000000000000000000000000/import').set('Authorization', `Bearer ${nonAdmin}`);
  assert.equal(importRes.status, 403);
});

test('IDOR/BOLA: a syntactically valid but nonexistent share_id 404s on both import and revoke -- no crash, no information leak', async () => {
  const admin = tokenFor('ORG-DIVERGE-IDOR', 'admin', 'diverge_idor_admin');
  const fakeButValidObjectId = '64f000000000000000000abc'; // 24 hex chars, valid ObjectId shape, guaranteed not to exist
  const importRes = await request(app).post(`/api/design-shares/${fakeButValidObjectId}/import`).set('Authorization', `Bearer ${admin}`);
  assert.equal(importRes.status, 404);
  const revokeRes = await request(app).delete(`/api/design-shares/${fakeButValidObjectId}`).set('Authorization', `Bearer ${admin}`);
  assert.equal(revokeRes.status, 404);
});

test('an unrelated third organization (never party to the share) cannot import it, revoke it, or see it in either of its own lists', async () => {
  const ORG_A = 'ORG-DIVERGE-3WAY-A';
  const ORG_B = 'ORG-DIVERGE-3WAY-B';
  const ORG_C = 'ORG-DIVERGE-3WAY-C';
  const adminA = tokenFor(ORG_A, 'admin', 'diverge3_admin_a');
  const adminB = tokenFor(ORG_B, 'admin', 'diverge3_admin_b');
  const adminC = tokenFor(ORG_C, 'admin', 'diverge3_admin_c');

  const Organization = require('../models/organization_schema');
  await Organization.create([
    { organization_code: ORG_B, name: '3way B', city: 'C', state: 'S', country: 'PY', email: '3wayb@example.test', phone: '0', status: 'ACTIVE', plan: 'Free' },
  ]);

  const createRes = await request(app).post('/api/designs').set('Authorization', `Bearer ${adminA}`).send(DESIGN_PAYLOAD('3-way share test'));
  const designCode = createRes.body.data.design_code;
  await request(app).post(`/api/designs/${designCode}/publish`).set('Authorization', `Bearer ${adminA}`);
  const shareRes = await request(app).post('/api/design-shares').set('Authorization', `Bearer ${adminA}`).send({ design_code: designCode, target_organization_code: ORG_B });
  const shareId = shareRes.body.data._id;

  const cImportRes = await request(app).post(`/api/design-shares/${shareId}/import`).set('Authorization', `Bearer ${adminC}`);
  assert.equal(cImportRes.status, 403);
  const cRevokeRes = await request(app).delete(`/api/design-shares/${shareId}`).set('Authorization', `Bearer ${adminC}`);
  assert.equal(cRevokeRes.status, 403);
  const cReceivedRes = await request(app).get('/api/design-shares/received').set('Authorization', `Bearer ${adminC}`);
  assert.deepEqual(cReceivedRes.body.data, []);
  const cSentRes = await request(app).get('/api/design-shares/sent').set('Authorization', `Bearer ${adminC}`);
  assert.deepEqual(cSentRes.body.data, []);

  const Design = require('../models/designSchema');
  const stillOnlyOneDesign = await Design.countDocuments({ design_code: designCode });
  assert.equal(stillOnlyOneDesign, 1, 'C\'s failed import attempt must never have created any copy');
});
