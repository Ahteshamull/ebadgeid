// tests/customFieldsHistoricalIntegrity.integration.test.js
//
// Point 6 (Credential Studio closure round): extends the existing
// tests/customFields.unit.test.js and tests/customFieldsIssuance.
// integration.test.js coverage with the specific scenarios the spec calls
// out that weren't yet proven -- Unicode, long text, special/HTML/
// JavaScript-looking characters actually round-tripping unharmed through
// the real HTTP + MongoDB path (not just the pure sanitizer unit tests),
// and the core data-integrity guarantee: a credential's custom_fields must
// never change because the template's field definitions changed or a
// field was removed after the fact.
// Real HTTP requests against the real Express app (api.js), a real
// MongoDB (mongodb-memory-server).
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { sanitizeCustomFields, MAX_VALUE_LENGTH } = require('../utils/customFields');
const { stubEmailTransport } = require('./testHelpers/stubEmailTransport');
let emailStub;

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';

let mongod;
let app;

function tokenFor(orgCode, role, username) {
  return jwt.sign({ id: crypto.randomUUID(), username, role, organization_code: orgCode }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

async function seedOrgAndPlan(orgCode) {
  const Organization = require('../models/organization_schema');
  const Plan = require('../models/plan_schema');
  await Organization.create({ organization_code: orgCode, name: `${orgCode} Org`, city: 'C', state: 'S', country: 'PY', email: `${orgCode.toLowerCase()}@example.test`, phone: '0', status: 'ACTIVE', plan: 'Free' });
  await Plan.findOneAndUpdate({ name: 'Free' }, { name: 'Free', max_users: 5, max_credentials_per_month: 25, max_api_calls_per_month: 500 }, { upsert: true });
}

test.before(async () => {
  emailStub = stubEmailTransport();
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
});

test.after(async () => {
  emailStub.restore();
  await mongoose.disconnect();
  await mongod.stop();
});

test('unit: Unicode, HTML, and JavaScript-looking values pass through the sanitizer completely unmodified (no escaping, no stripping)', () => {
  const result = sanitizeCustomFields({
    unicode_field: '日本語 中文 العربية Ñoño 🎓🏆✨',
    html_field: '<b>bold</b><img src=x onerror=alert(1)>',
    js_field: '<script>alert(document.cookie)</script>',
    quotes_field: `it's a "test" with \`backticks\` and \\backslashes\\`,
  });
  assert.equal(result.unicode_field, '日本語 中文 العربية Ñoño 🎓🏆✨');
  assert.equal(result.html_field, '<b>bold</b><img src=x onerror=alert(1)>');
  assert.equal(result.js_field, '<script>alert(document.cookie)</script>');
  assert.equal(result.quotes_field, `it's a "test" with \`backticks\` and \\backslashes\\`);
});

test('unit: an empty string is a legitimate value, distinct from a missing/null one', () => {
  const result = sanitizeCustomFields({ empty_field: '' });
  assert.equal(result.empty_field, '');
  assert.ok(Object.prototype.hasOwnProperty.call(result, 'empty_field'));
});

test('integration: the full cycle survives Unicode, HTML/JS-looking, and near-max-length values through real HTTP + MongoDB storage, unescaped and unexecuted', async () => {
  const ORG = 'ORG-CUSTOMFIELDS-EXTRA';
  const admin = tokenFor(ORG, 'admin', 'cf_extra_admin');
  await seedOrgAndPlan(ORG);
  const UserProfile = require('../models/user_model');
  await UserProfile.create({ username: 'cf_extra_recipient', organization_code: ORG, first_name: 'R', last_name: 'One', designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'cfextra@example.test', phone: '0', status: 'Active' });

  const designRes = await request(app).post('/api/designs').set('Authorization', `Bearer ${admin}`).send({
    main_template_url: 'https://example.test/t.png', template_url: 'https://example.test/t.png', credential_title: 'CF Extra Template',
    text_attributes: [
      { text_title: 'recipient_name', text: 'Name', font_attributes: [{ font_family: 'Georgia', font_size: 24, font_color: '#000', font_weight: 'normal' }], positions: { X: 10, Y: 10 } },
      { text_title: 'course_name', text: 'Default', font_attributes: [{ font_family: 'Georgia', font_size: 18, font_color: '#000', font_weight: 'normal' }], positions: { X: 10, Y: 60 } },
    ],
    QR_CODE: { ecoding_data: 'placeholder', X: 0, Y: 0 },
  });
  const designCode = designRes.body.data.design_code;
  await request(app).post(`/api/designs/${designCode}/publish`).set('Authorization', `Bearer ${admin}`);

  const longButValid = 'x'.repeat(MAX_VALUE_LENGTH); // exactly at the limit, must not be rejected
  const dangerousValue = '<script>alert(1)</script>日本語🎓';

  const createRes = await request(app).post('/api/credentials/create').set('Authorization', `Bearer ${admin}`).send({
    credential_pic_url: `${process.env.PUBLIC_STORAGE_BASE_URL}/uploads/whatever.png`,
    achiever_username: 'cf_extra_recipient',
    credential_code: 'CRED-3100000000000001',
    custom_fields: { course_name: dangerousValue, notes: longButValid },
  });
  assert.equal(createRes.status, 201, JSON.stringify(createRes.body));

  const Credential = require('../models/credentialSchema');
  const saved = await Credential.findOne({ credential_code: 'CRED-3100000000000001' }).lean();
  assert.equal(saved.custom_fields.course_name, dangerousValue, 'must be stored byte-for-byte, not escaped or stripped');
  assert.equal(saved.custom_fields.notes, longButValid);
  assert.equal(saved.custom_fields.notes.length, MAX_VALUE_LENGTH);
  // The one place a browser ever renders this back is the frontend, via
  // React's default JSX escaping (confirmed separately: zero
  // dangerouslySetInnerHTML usage anywhere in frontend/src) -- not any
  // server-side stripping, which is why the raw value is intentionally
  // stored byte-for-byte above rather than sanitized as HTML server-side.
});

test('a credential\'s custom_fields never change when the template\'s field definitions change afterward, even if the field is removed entirely', async () => {
  const ORG = 'ORG-CUSTOMFIELDS-IMMUTABLE';
  const admin = tokenFor(ORG, 'admin', 'cf_immutable_admin');
  await seedOrgAndPlan(ORG);
  const UserProfile = require('../models/user_model');
  await UserProfile.create({ username: 'cf_immutable_recipient', organization_code: ORG, first_name: 'R', last_name: 'One', designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'cfimmutable@example.test', phone: '0', status: 'Active' });

  const designRes = await request(app).post('/api/designs').set('Authorization', `Bearer ${admin}`).send({
    main_template_url: 'https://example.test/t.png', template_url: 'https://example.test/t.png', credential_title: 'CF Immutable Template',
    text_attributes: [
      { text_title: 'recipient_name', text: 'Name', font_attributes: [{ font_family: 'Georgia', font_size: 24, font_color: '#000', font_weight: 'normal' }], positions: { X: 10, Y: 10 } },
      { text_title: 'cohort', text: 'Default cohort', font_attributes: [{ font_family: 'Georgia', font_size: 18, font_color: '#000', font_weight: 'normal' }], positions: { X: 10, Y: 60 } },
    ],
    QR_CODE: { ecoding_data: 'placeholder', X: 0, Y: 0 },
  });
  const designCode = designRes.body.data.design_code;
  const designVersion = designRes.body.data.current_version;
  await request(app).post(`/api/designs/${designCode}/publish`).set('Authorization', `Bearer ${admin}`);

  // Issue a credential carrying a value for the "cohort" field.
  const createRes = await request(app).post('/api/credentials/create').set('Authorization', `Bearer ${admin}`).send({
    credential_pic_url: `${process.env.PUBLIC_STORAGE_BASE_URL}/uploads/whatever2.png`,
    achiever_username: 'cf_immutable_recipient',
    credential_code: 'CRED-3200000000000001',
    custom_fields: { cohort: 'Cohort Fall 2026' },
  });
  assert.equal(createRes.status, 201);

  // Now the template's field definitions change -- "cohort" is removed
  // entirely, and a completely different field is introduced instead.
  await request(app).put(`/api/designs/${designCode}`).set('Authorization', `Bearer ${admin}`).send({
    known_version: designVersion,
    text_attributes: [
      { text_title: 'recipient_name', text: 'Name', font_attributes: [{ font_family: 'Georgia', font_size: 24, font_color: '#000', font_weight: 'normal' }], positions: { X: 10, Y: 10 } },
      { text_title: 'specialization', text: 'Default specialization', font_attributes: [{ font_family: 'Georgia', font_size: 18, font_color: '#000', font_weight: 'normal' }], positions: { X: 10, Y: 60 } },
    ],
  });

  const Design = require('../models/designSchema');
  const updatedDesign = await Design.findOne({ design_code: designCode }).lean();
  assert.equal(updatedDesign.text_attributes.some((a) => a.text_title === 'cohort'), false, 'sanity check: the field really was removed from the template');

  // The already-issued credential must be completely unaffected.
  const Credential = require('../models/credentialSchema');
  const stillThere = await Credential.findOne({ credential_code: 'CRED-3200000000000001' }).lean();
  assert.equal(stillThere.custom_fields.cohort, 'Cohort Fall 2026', 'a historical credential must never change because the template definition changed later');

  // And issuing a NEW credential from the now-changed template, without
  // supplying a value for "cohort" (since it doesn't exist anymore), must
  // not error and must not resurrect the removed field.
  const newCredRes = await request(app).post('/api/credentials/create').set('Authorization', `Bearer ${admin}`).send({
    credential_pic_url: `${process.env.PUBLIC_STORAGE_BASE_URL}/uploads/whatever3.png`,
    achiever_username: 'cf_immutable_recipient',
    credential_code: 'CRED-3200000000000002',
    custom_fields: { specialization: 'Backend Systems' },
  });
  assert.equal(newCredRes.status, 201);
  const newCred = await Credential.findOne({ credential_code: 'CRED-3200000000000002' }).lean();
  assert.equal(newCred.custom_fields.specialization, 'Backend Systems');
  assert.equal(newCred.custom_fields.cohort, undefined, 'the removed field must not silently reappear on a new credential either');
});
