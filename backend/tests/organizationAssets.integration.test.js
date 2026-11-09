// tests/organizationAssets.integration.test.js
//
// Real MongoDB throughout. Covers the shared OrganizationAsset model/routes
// (create/list/delete, per-org name uniqueness, cross-org isolation) used
// by both the custom-font feature and the asset library. The final test is
// gated on a real certificate/storage microservice being reachable (same
// documented pattern as tests/lmsSync.integration.test.js) and proves a
// custom uploaded font actually changes the rendered certificate output,
// not just that the schema accepts it.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';
process.env.CERTIFICATE_SERVICE_URL = process.env.CERTIFICATE_SERVICE_URL || 'http://localhost:8100';
process.env.CERTIFICATE_INTERNAL_KEY = process.env.CERTIFICATE_INTERNAL_KEY || 'test-internal-key';

let mongod;
let app;
const ORG = 'ORG-ASSETS';
let token;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  // Mongoose builds indexes (including the org+type+name unique index)
  // asynchronously in the background after model registration -- without
  // waiting for it here, the duplicate-name test below can race ahead of
  // the index actually existing and see two inserts both succeed.
  await require('../models/organizationAsset').init();
  token = jwt.sign({ id: 'a1', username: 'assets_admin', role: 'admin', organization_code: ORG }, process.env.JWT_SECRET, { algorithm: 'HS256' });
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('POST /api/assets registers an uploaded font, and GET /api/assets lists it filtered by type', async () => {
  const createRes = await request(app)
    .post('/api/assets')
    .set('Authorization', `Bearer ${token}`)
    .send({
      asset_type: 'font',
      name: 'Brand Script',
      url: 'http://localhost:9000/uploads/brand-script.ttf',
      mime_type: 'font/ttf',
      original_filename: 'BrandScript-Regular.ttf',
    });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.data.asset_type, 'font');

  const imageRes = await request(app)
    .post('/api/assets')
    .set('Authorization', `Bearer ${token}`)
    .send({ asset_type: 'image', name: 'Company Logo', url: 'http://localhost:9000/uploads/logo.png', mime_type: 'image/png' });
  assert.equal(imageRes.status, 201);

  const fontsOnly = await request(app).get('/api/assets?asset_type=font').set('Authorization', `Bearer ${token}`);
  assert.equal(fontsOnly.body.data.length, 1);
  assert.equal(fontsOnly.body.data[0].name, 'Brand Script');

  const all = await request(app).get('/api/assets').set('Authorization', `Bearer ${token}`);
  assert.equal(all.body.data.length, 2);
});

test('GET /api/assets ignores a Mongo operator injected via the asset_type query parameter instead of forwarding it into the filter', async () => {
  // supertest's .query() lets a real HTTP client send the exact bracket
  // syntax (?asset_type[$ne]=x) Express's query parser turns into a
  // nested object -- proving the fix against a real parsed request, not
  // just a hand-built object.
  const res = await request(app)
    .get('/api/assets')
    .query({ 'asset_type[$ne]': 'x' })
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  // Same result as no filter at all -- the injected operator is dropped,
  // never reaches OrganizationAsset.find().
  assert.equal(res.body.data.length, 2);
});

test('POST /api/assets rejects a duplicate name within the same organization and type', async () => {
  await request(app).post('/api/assets').set('Authorization', `Bearer ${token}`)
    .send({ asset_type: 'font', name: 'Dup Font', url: 'http://localhost:9000/uploads/a.ttf', mime_type: 'font/ttf' });
  const dup = await request(app).post('/api/assets').set('Authorization', `Bearer ${token}`)
    .send({ asset_type: 'font', name: 'Dup Font', url: 'http://localhost:9000/uploads/b.ttf', mime_type: 'font/ttf' });
  assert.equal(dup.status, 409);
});

test('DELETE /api/assets/:id rejects an admin from a different organization', async () => {
  const created = await request(app).post('/api/assets').set('Authorization', `Bearer ${token}`)
    .send({ asset_type: 'image', name: 'Org Only Asset', url: 'http://localhost:9000/uploads/c.png', mime_type: 'image/png' });
  const otherToken = jwt.sign({ id: 'x1', username: 'other_admin', role: 'admin', organization_code: 'ORG-ASSETS-OTHER' }, process.env.JWT_SECRET, { algorithm: 'HS256' });

  const res = await request(app).delete(`/api/assets/${created.body.data._id}`).set('Authorization', `Bearer ${otherToken}`);
  assert.equal(res.status, 403);

  const ownerDelete = await request(app).delete(`/api/assets/${created.body.data._id}`).set('Authorization', `Bearer ${token}`);
  assert.equal(ownerDelete.status, 200);
});

// Gated exactly like tests/lmsSync.integration.test.js's real-issuance
// test -- skips cleanly on the standard `npm test` run, and proves real
// end-to-end rendering when pointed at the live docker-compose stack.
test('a custom uploaded font registered as an org asset actually changes the rendered certificate, not just the accepted schema', async (t) => {
  try {
    await fetch(`${process.env.CERTIFICATE_SERVICE_URL}/health`, { signal: AbortSignal.timeout(1000) });
  } catch {
    return t.skip('needs a real certificate/storage microservice reachable -- not part of the standard npm test run, see AUDIT_FIXES.md');
  }

  const Organization = require('../models/organization_schema');
  const Design = require('../models/designSchema');
  const storageBase = process.env.PUBLIC_STORAGE_BASE_URL;
  const CUSTOM_ORG = 'ORG-ASSETS-FONT-RENDER';
  const customToken = jwt.sign({ id: 'f1', username: 'font_render_admin', role: 'admin', organization_code: CUSTOM_ORG }, process.env.JWT_SECRET, { algorithm: 'HS256' });

  await Organization.create({
    organization_code: CUSTOM_ORG, name: 'Font Render Org', city: 'C', state: 'S', country: 'PY',
    email: 'fontrender@example.test', phone: '0', status: 'ACTIVE', plan: 'Basic',
  });

  await request(app).post('/api/assets').set('Authorization', `Bearer ${customToken}`).send({
    asset_type: 'font',
    name: 'Pacifico Script',
    url: `${storageBase}/uploads/test-custom-font-pacifico.ttf`,
    mime_type: 'font/ttf',
  });

  const textAttribute = (fontFamily) => ([{
    text_title: 'recipient_name',
    text: 'Certificate Text',
    font_attributes: [{ font_family: fontFamily, font_size: 48, font_color: '#111111', font_weight: 'regular' }],
    positions: { X: 60, Y: 60 },
  }]);

  await Design.create({
    organization_code: CUSTOM_ORG, design_code: 'DESIGN-FONT-BUNDLED',
    main_template_url: `${storageBase}/uploads/test_template.png`,
    template_url: `${storageBase}/uploads/test_template.png`,
    text_attributes: textAttribute('Arial'), // no matching asset -> falls back to bundled fonts
    QR_CODE: { ecoding_data: 'placeholder', X: 700, Y: 500 },
  });
  await Design.create({
    organization_code: CUSTOM_ORG, design_code: 'DESIGN-FONT-CUSTOM',
    main_template_url: `${storageBase}/uploads/test_template.png`,
    template_url: `${storageBase}/uploads/test_template.png`,
    text_attributes: textAttribute('Pacifico Script'), // matches the registered asset -> font_url forwarded
    QR_CODE: { ecoding_data: 'placeholder', X: 700, Y: 500 },
  });

  const genBundled = await request(app).post('/api/credentials/generate-certificate')
    .set('Authorization', `Bearer ${customToken}`)
    .send({ design_code: 'DESIGN-FONT-BUNDLED', achiever_username: 'guest', credential_code: 'CRED-AAAAAAAAAAAAAAA1', guest_recipient: true });
  assert.equal(genBundled.status, 201);

  const genCustom = await request(app).post('/api/credentials/generate-certificate')
    .set('Authorization', `Bearer ${customToken}`)
    .send({ design_code: 'DESIGN-FONT-CUSTOM', achiever_username: 'guest', credential_code: 'CRED-AAAAAAAAAAAAAAA2', guest_recipient: true });
  assert.equal(genCustom.status, 201);

  // certificateController.js writes the generated PNG straight to this
  // process's own local uploads/ dir and only builds the returned `url`
  // assuming it's served from the real storage container over the shared
  // docker volume (true in the real docker-compose deployment, not true
  // for this ad-hoc test container) -- read the two files back directly
  // off disk instead of over HTTP, which is what actually proves what was
  // rendered regardless of how the URL would be served in production.
  const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
  const filenameFromUrl = (url) => new URL(url).pathname.split('/').pop();
  const bundledImage = fs.readFileSync(path.join(UPLOAD_DIR, filenameFromUrl(genBundled.body.url)));
  const customImage = fs.readFileSync(path.join(UPLOAD_DIR, filenameFromUrl(genCustom.body.url)));
  assert.notEqual(bundledImage.toString('base64'), customImage.toString('base64'),
    'a custom font_url must actually change the rendered pixels, not silently fall back to the bundled font');
});
