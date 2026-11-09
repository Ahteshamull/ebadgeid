// tests/customFieldsIssuance.integration.test.js
//
// custom_fields end to end: a design can now have text_attributes beyond
// just recipient_name (e.g. course_name, cohort -- see models/designSchema.js,
// unchanged schema, this was always technically possible, just nothing ever
// sent a value for anything but recipient_name). generateCertificate
// substitutes a caller-supplied value for any matching text_title, and
// createCredential persists whatever was actually used on the credential
// document for later display.
//
// The 400-validation tests below run in the standard `npm test` pass with
// no external dependency, because sanitizeCustomFields() rejects a bad
// payload before generateCertificate ever calls the certificate
// microservice. The real-issuance tests need that microservice reachable
// (same documented skip-if-unreachable pattern as
// tests/certificateGeneration.integration.test.js) since only a real
// render can prove the substitution reached the actual image request.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { stubEmailTransport } = require('./testHelpers/stubEmailTransport');
let emailStub;

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';
process.env.CERTIFICATE_SERVICE_URL = process.env.CERTIFICATE_SERVICE_URL || 'http://localhost:8100';
process.env.CERTIFICATE_INTERNAL_KEY = process.env.CERTIFICATE_INTERNAL_KEY || 'test-internal-key';

let mongod;
let app;
const ORG = 'ORG-CUSTOMFIELDS';
let adminToken;

test.before(async () => {
  emailStub = stubEmailTransport();
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  adminToken = jwt.sign({ id: crypto.randomUUID(), username: 'customfields_admin', role: 'admin', organization_code: ORG }, process.env.JWT_SECRET, { algorithm: 'HS256' });

  const UserProfile = require('../models/user_model');
  await UserProfile.create({
    username: 'customfields_recipient', organization_code: ORG, first_name: 'R', last_name: 'One',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'customfieldsrecipient@example.test', phone: '0', status: 'Active',
  });

  // createCredential's route (POST /api/credentials/create) sits behind
  // checkCredentialLimit, which 403s outright with no Organization/Plan
  // documents to look up -- seeded explicitly here rather than relying on
  // config/db.js's own first-boot seeding, which only runs against the
  // real connect() path, not the MongoMemoryServer connection tests use.
  const Organization = require('../models/organization_schema');
  const Plan = require('../models/plan_schema');
  await Organization.create({
    organization_code: ORG, name: 'Custom Fields Test Org', city: 'C', state: 'S', country: 'PY',
    email: 'customfieldsorg@example.test', phone: '0', status: 'ACTIVE', plan: 'Free',
  });
  await Plan.findOneAndUpdate(
    { name: 'Free' },
    { name: 'Free', max_users: 5, max_credentials_per_month: 25, max_api_calls_per_month: 500 },
    { upsert: true },
  );

  await request(app)
    .post('/api/designs')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      design_code: 'DESIGN-CUSTOMFIELDS-001',
      main_template_url: 'http://localhost:9000/uploads/test_template.png',
      template_url: 'http://localhost:9000/uploads/test_template.png',
      credential_title: 'Custom Fields Test Template',
      text_attributes: [
        { text_title: 'recipient_name', text: 'Name', font_attributes: [{ font_family: 'Georgia', font_size: 24, font_color: '#000000', font_weight: 'normal' }], positions: { X: 10, Y: 10 } },
        { text_title: 'course_name', text: 'Default Course', font_attributes: [{ font_family: 'Georgia', font_size: 18, font_color: '#000000', font_weight: 'normal' }], positions: { X: 10, Y: 60 } },
      ],
      QR_CODE: { ecoding_data: 'placeholder', X: 0, Y: 0 },
    });
  await request(app).post('/api/designs/DESIGN-CUSTOMFIELDS-001/publish').set('Authorization', `Bearer ${adminToken}`);
});

test.after(async () => {
  emailStub.restore();
  await mongoose.disconnect();
  await mongod.stop();
});

test('generateCertificate rejects a non-object custom_fields with 400, before touching the certificate service', async () => {
  const res = await request(app)
    .post('/api/credentials/generate-certificate')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ design_code: 'DESIGN-CUSTOMFIELDS-001', achiever_username: 'customfields_recipient', credential_code: 'CRED-3000000000000001', custom_fields: 'not-an-object' });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /custom_fields must be an object/);
});

test('generateCertificate rejects a custom_fields value that is neither a string nor a number', async () => {
  const res = await request(app)
    .post('/api/credentials/generate-certificate')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ design_code: 'DESIGN-CUSTOMFIELDS-001', achiever_username: 'customfields_recipient', credential_code: 'CRED-3000000000000002', custom_fields: { course_name: { nested: true } } });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /custom_fields\.course_name must be a string or number/);
});

test('createCredential rejects an invalid custom_fields payload with 400', async () => {
  const res = await request(app)
    .post('/api/credentials/create')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      credential_pic_url: `${process.env.PUBLIC_STORAGE_BASE_URL}/uploads/whatever.png`,
      achiever_username: 'customfields_recipient',
      credential_code: 'CRED-3000000000000003',
      custom_fields: ['not', 'an', 'object'],
    });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /custom_fields must be an object/);
});

test('a real render with custom_fields succeeds, and the credential it creates persists them', async (t) => {
  try {
    await fetch(`${process.env.CERTIFICATE_SERVICE_URL}/health`, { signal: AbortSignal.timeout(1000) });
  } catch {
    return t.skip('needs the real certificate microservice reachable -- not part of the standard npm test run');
  }

  const certRes = await request(app)
    .post('/api/credentials/generate-certificate')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      design_code: 'DESIGN-CUSTOMFIELDS-001',
      achiever_username: 'customfields_recipient',
      credential_code: 'CRED-3000000000000004',
      custom_fields: { course_name: 'Advanced Docker Operations', recipient_name: 'Should Be Ignored' },
    });
  assert.equal(certRes.status, 201, `expected the microservice to accept a custom field substitution, got ${certRes.status}: ${JSON.stringify(certRes.body)}`);
  assert.match(certRes.body.url, /^http/);

  const createRes = await request(app)
    .post('/api/credentials/create')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      credential_pic_url: certRes.body.url,
      achiever_username: 'customfields_recipient',
      credential_code: 'CRED-3000000000000004',
      custom_fields: { course_name: 'Advanced Docker Operations', recipient_name: 'Should Be Ignored' },
    });
  assert.equal(createRes.status, 201, JSON.stringify(createRes.body));

  const Credential = require('../models/credentialSchema');
  const saved = await Credential.findOne({ credential_code: 'CRED-3000000000000004' }).lean();
  assert.deepEqual(saved.custom_fields, { course_name: 'Advanced Docker Operations' }, 'recipient_name must never be persisted through custom_fields -- achiever_details is the source of truth for that');
});
