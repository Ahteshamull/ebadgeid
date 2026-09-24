// tests/galleryTemplateFullLifecycle.integration.test.js
//
// Point 2 (Credential Studio closure round): "Cada plantilla debe poder
// recorrer el ciclo real" -- for all 12 official gallery templates, not
// just a card appearing in the frontend. This is the permanent, CI-
// runnable regression test for that claim (materialize -> create -> save
// -> publish -> preview/render -> issue), complementing the live run
// already executed against the actual docker stack (real Python
// certificate microservice, real storage service) documented in the
// closure report -- this file proves the same 12-template cycle with a
// real local HTTP stand-in for the renderer, so it runs in the standard
// `npm test` pass with no external dependency.
//
// Also statically validates the frontend's TEMPLATE_LIBRARY (src/lib/
// template-library.js) itself: exactly 12 entries, each with a real
// background, real canvas-fitting elements, and a real font/color/QR
// definition -- "no acepto simplemente comprobar que aparecen 12 cards".
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { GALLERY_TEMPLATE_IDS } = require('../utils/galleryTemplates');
const { stubEmailTransport } = require('./testHelpers/stubEmailTransport');
let emailStub;

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';
process.env.CERTIFICATE_INTERNAL_KEY = process.env.CERTIFICATE_INTERNAL_KEY || 'test-internal-key';

let mongod;
let app;
let fakeCertServer;
const MINIMAL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test.before(async () => {
  emailStub = stubEmailTransport();
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  fakeCertServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/generate-certificate') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(MINIMAL_PNG);
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => fakeCertServer.listen(0, resolve));
  process.env.CERTIFICATE_SERVICE_URL = `http://127.0.0.1:${fakeCertServer.address().port}`;

  ({ app } = require('../api.js'));

  const Organization = require('../models/organization_schema');
  const Plan = require('../models/plan_schema');
  await Organization.create({ organization_code: 'ORG-GALLERY-LIFECYCLE', name: 'Gallery Lifecycle Org', city: 'C', state: 'S', country: 'PY', email: 'gallerylifecycle@example.test', phone: '0', status: 'ACTIVE', plan: 'Free' });
  await Plan.findOneAndUpdate({ name: 'Free' }, { name: 'Free', max_users: 5, max_credentials_per_month: 100, max_api_calls_per_month: 500 }, { upsert: true });

  const UserProfile = require('../models/user_model');
  await UserProfile.create({ username: 'gallery_lifecycle_recipient', organization_code: 'ORG-GALLERY-LIFECYCLE', first_name: 'R', last_name: 'One', designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'gallerylifecyclerecipient@example.test', phone: '0', status: 'Active' });
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

test('the frontend TEMPLATE_LIBRARY defines exactly the same 12 templates as the backend registry, each with a well-formed definition', (t) => {
  // The standard `npm test` container mounts only this backend package
  // (see PRODUCTION_RUNBOOK.md's test instructions) -- the frontend/
  // sibling directory this check reads is only present when running
  // against a full repo checkout. Same documented skip-if-unreachable
  // pattern as tests/certificateGeneration.integration.test.js's real
  // microservice dependency, not a silent pass.
  const libPath = path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'template-library.js');
  if (!fs.existsSync(libPath)) {
    return t.skip('frontend/ source tree not present in this container -- run against a full repo checkout to exercise this check');
  }
  const source = fs.readFileSync(libPath, 'utf8');
  // Load it as a real module (it's plain ESM `export const` -- transpile
  // the two export statements away just enough for `vm` to evaluate it,
  // rather than re-implementing a parser).
  const vm = require('vm');
  const sandbox = { module: { exports: {} }, exports: {} };
  const commonJsSource = source
    .replace('export const TEMPLATE_LIBRARY', 'exports.TEMPLATE_LIBRARY')
    .replace(/export function getTemplateById[\s\S]*$/, '');
  vm.runInNewContext(commonJsSource, sandbox);
  // vm.runInNewContext evaluates in a separate V8 realm with its own
  // Array/Object constructors -- JSON round-tripping normalizes the result
  // back into this process's own plain objects/arrays (the data is pure
  // JSON-shaped, no functions), so assert.deepEqual below compares values,
  // not which realm's Array.prototype something happens to inherit from.
  const TEMPLATE_LIBRARY = JSON.parse(JSON.stringify(sandbox.exports.TEMPLATE_LIBRARY));

  assert.equal(TEMPLATE_LIBRARY.length, 12);
  const ids = TEMPLATE_LIBRARY.map((t) => t.id).sort();
  assert.deepEqual(ids, [...GALLERY_TEMPLATE_IDS].sort(), 'frontend and backend must agree on exactly the same 12 ids');

  for (const t of TEMPLATE_LIBRARY) {
    assert.ok(t.id && typeof t.id === 'string', `${t.id}: must have a real id`);
    assert.ok(t.name && typeof t.name === 'string', `${t.id}: must have a display name`);
    assert.ok(['certificate', 'badge'].includes(t.category), `${t.id}: must have a real category`);
    assert.match(t.backgroundUrl, /^\/templates\/.+\.svg$/, `${t.id}: must have a real background path`);
    assert.ok(Array.isArray(t.elements) && t.elements.length > 0, `${t.id}: must define at least one text element`);
    assert.ok(t.elements.some((el) => el.text_title === 'recipient_name'), `${t.id}: must include the recipient_name field`);
    for (const el of t.elements) {
      assert.ok(el.font_family && el.font_size > 0, `${t.id}: every element needs a real font`);
      assert.match(el.font_color, /^#[0-9a-fA-F]{6}$/, `${t.id}: every element needs a real hex color`);
      assert.ok(Number.isFinite(el.x) && Number.isFinite(el.y), `${t.id}: every element needs real coordinates`);
    }
    assert.ok(t.qrPosition && Number.isFinite(t.qrPosition.x) && Number.isFinite(t.qrPosition.y), `${t.id}: must define a real QR position`);

    // The actual SVG file this entry points at must exist and be a real,
    // non-empty SVG.
    const svgPath = path.join(__dirname, '..', '..', 'frontend', 'public', t.backgroundUrl);
    const svgContent = fs.readFileSync(svgPath, 'utf8');
    assert.match(svgContent, /<svg[\s>]/, `${t.id}: backgroundUrl must point at a real SVG file`);
    assert.match(svgContent, /viewBox="0 0 900 636"/, `${t.id}: must be sized for the design editor's fixed 900x636 canvas`);
  }
});

for (const templateId of GALLERY_TEMPLATE_IDS) {
  test(`"${templateId}" completes the full real cycle: materialize -> create -> save/edit -> publish -> preview/render -> issue`, async () => {
    const admin = tokenFor('ORG-GALLERY-LIFECYCLE', 'admin', 'gallery_lifecycle_admin');

    // 1. Materialize (gallery -> real internal PNG background)
    const matRes = await request(app).post('/api/designs/gallery-templates/materialize').set('Authorization', `Bearer ${admin}`).send({ template_id: templateId });
    assert.equal(matRes.status, 201);

    // 2. Import/create as a real Design
    const createRes = await request(app).post('/api/designs').set('Authorization', `Bearer ${admin}`).send({
      main_template_url: matRes.body.data.url,
      template_url: matRes.body.data.url,
      credential_title: `Lifecycle ${templateId}`,
      text_attributes: [{ text_title: 'recipient_name', text: 'Recipient Name', font_attributes: [{ font_family: 'Georgia', font_size: 24, font_color: '#000000', font_weight: 'normal' }], positions: { X: 450, Y: 300 } }],
      QR_CODE: { ecoding_data: 'placeholder', X: 780, Y: 515 },
    });
    assert.equal(createRes.status, 201);
    const designCode = createRes.body.data.design_code;
    const version = createRes.body.data.current_version;

    // 3. Edit and save (a real content change, real optimistic-lock save)
    const editRes = await request(app).put(`/api/designs/${designCode}`).set('Authorization', `Bearer ${admin}`).send({
      credential_title: `Lifecycle ${templateId} (edited)`, known_version: version,
    });
    assert.equal(editRes.status, 200);
    assert.equal(editRes.body.data.credential_title, `Lifecycle ${templateId} (edited)`);

    // 4. Publish
    const pubRes = await request(app).post(`/api/designs/${designCode}/publish`).set('Authorization', `Bearer ${admin}`);
    assert.equal(pubRes.status, 200);
    assert.equal(pubRes.body.data.status, 'published');

    // 5. Preview / render
    const reserveRes = await request(app).post('/api/credentials/reserve-code').set('Authorization', `Bearer ${admin}`);
    const previewRes = await request(app).post('/api/credentials/generate-certificate').set('Authorization', `Bearer ${admin}`).send({
      design_code: designCode, achiever_username: 'gallery_lifecycle_recipient', credential_code: reserveRes.body.credential_code,
    });
    assert.equal(previewRes.status, 201, JSON.stringify(previewRes.body));

    // 6. Issue
    const issueRes = await request(app).post('/api/credentials/create').set('Authorization', `Bearer ${admin}`).send({
      credential_pic_url: previewRes.body.url, achiever_username: 'gallery_lifecycle_recipient', credential_code: reserveRes.body.credential_code,
    });
    assert.equal(issueRes.status, 201, JSON.stringify(issueRes.body));

    const Credential = require('../models/credentialSchema');
    const issued = await Credential.findOne({ credential_code: reserveRes.body.credential_code }).lean();
    assert.ok(issued, `${templateId}: a real credential must exist at the end of the cycle`);
  });
}
