// tests/certificateGeneration.integration.test.js
//
// Real, live verification against the actual certificate microservice --
// not part of the standard `npm test` run (same documented pattern as
// tests/lmsSync.integration.test.js's own certificate-service check):
// skips cleanly when CERTIFICATE_SERVICE_URL isn't reachable, runs for
// real otherwise.
//
// Found while verifying real LMS credential issuance end to end: a design
// with a placed decorative image (asset library / AI-generated) always
// failed to issue, in any real docker-compose deployment -- 502 from
// generateCertificate, "Certificate image element rejected" in the
// certificate microservice's own logs. The image's URL never went through
// internalTemplateUrl() the way template_url and font_url already did, so
// the microservice (which can only reach storage on the internal docker
// network -- TEMPLATE_ALLOWED_HOSTS=storage) got the real *public* storage
// URL instead and rejected it. Not specific to LMS sync -- any design with
// a placed image was unissuable through this path at all.
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
const ORG = 'ORG-CERTGEN';
let adminToken;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  adminToken = jwt.sign({ id: crypto.randomUUID(), username: 'certgen_admin', role: 'admin', organization_code: ORG }, process.env.JWT_SECRET, { algorithm: 'HS256' });
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('generateCertificate succeeds for a real, published design with a placed decorative image', async (t) => {
  try {
    await fetch(`${process.env.CERTIFICATE_SERVICE_URL}/health`, { signal: AbortSignal.timeout(1000) });
  } catch {
    return t.skip('needs the real certificate microservice reachable -- not part of the standard npm test run, see AUDIT_FIXES.md');
  }

  const UserProfile = require('../models/user_model');
  await UserProfile.create({
    username: 'certgen_recipient', organization_code: ORG, first_name: 'R', last_name: 'One',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'certgenrecipient@example.test', phone: '0', status: 'Active',
  });

  const designRes = await request(app)
    .post('/api/designs')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      design_code: 'DESIGN-CERTGEN-IMG',
      main_template_url: 'http://localhost:9000/uploads/test_template.png',
      template_url: 'http://localhost:9000/uploads/test_template.png',
      credential_title: 'Cert Generation With Image',
      text_attributes: [{ text_title: 'recipient_name', text: 'Name', font_attributes: [{ font_family: 'Georgia', font_size: 24, font_color: '#000000', font_weight: 'normal' }], positions: { X: 10, Y: 10 } }],
      // The public storage URL, exactly the shape every real saved design
      // actually has -- this is the field that used to reach the
      // microservice unresolved.
      images: [{ url: 'http://localhost:9000/uploads/test_template.png', X: 50, Y: 50, width: 100, height: 100, rotation: 0, opacity: 0.5 }],
      QR_CODE: { ecoding_data: 'placeholder', X: 0, Y: 0 },
    });
  assert.equal(designRes.status, 201);
  await request(app).post('/api/designs/DESIGN-CERTGEN-IMG/publish').set('Authorization', `Bearer ${adminToken}`);

  const certRes = await request(app)
    .post('/api/credentials/generate-certificate')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ design_code: 'DESIGN-CERTGEN-IMG', achiever_username: 'certgen_recipient', credential_code: 'CRED-2000000000000001' });

  assert.equal(certRes.status, 201, `expected the microservice to accept the placed image, got ${certRes.status}: ${JSON.stringify(certRes.body)}`);
  assert.match(certRes.body.url, /^http/);
});
