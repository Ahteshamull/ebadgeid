// tests/credentialPublicPiiRedaction.integration.test.js
//
// Audit finding: the fully public GET /api/credentials/by-code/:code
// endpoint (no auth, anyone with the code can hit it) returned the
// recipient's full name, job title, and city, plus the issuing
// organization's direct support email/phone -- more than a "verify this
// credential is real" feature needs. Fixed in credentialController.js's
// publicAchieverView/publicOrganizationView. This proves the redaction
// against a credential actually issued with all of those fields
// populated, and confirms the legitimate feature (confirming who earned
// it, and which org issued it) still works -- this is a PII reduction,
// not a lockdown of the public verification feature itself.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function issueCredentialWithFullDetails() {
  const { createCredential } = require('../controllers/credentialController');
  const Organization = require('../models/organization_schema');

  await Organization.findOneAndUpdate(
    { organization_code: 'PII-ORG' },
    {
      organization_code: 'PII-ORG',
      name: 'PII Redaction Test Org',
      city: 'Org City', state: 'Org State', country: 'Org Country',
      email: 'org-support@example.com', phone: '555-2000', status: 'ACTIVE',
    },
    { upsert: true }
  );

  const req = {
    user: { organization_code: 'PII-ORG', username: 'admin-pii' },
    body: {
      credential_pic_url: 'http://localhost:9000/uploads/pii-cert.png',
      achiever_username: 'Recipient Name',
      credential_title: 'Certified Something',
      guest_recipient: {
        email: 'recipient@example.com',
        first_name: 'Recipient',
        last_name: 'Name',
        designation: 'Senior Vice President of Something Confidential',
        city: 'Recipient Home City',
      },
    },
  };
  const res = responseDouble();
  await createCredential(req, res);
  assert.equal(res.statusCode, 201);
  return res.body.credential_code;
}

test('GET /by-code strips the recipient\'s designation/city and the organization\'s support email/phone, but keeps identity fields needed for real verification', async () => {
  const { getCredentialByCode } = require('../controllers/credentialController');
  const credential_code = await issueCredentialWithFullDetails();

  const req = { params: { credential_code } };
  const res = responseDouble();
  await getCredentialByCode(req, res);

  assert.equal(res.statusCode, 200);
  const body = res.body;

  // Legitimate verification feature must still work: who earned it, from
  // which org, is it valid.
  assert.equal(body.achiever_details.first_name, 'Recipient');
  assert.equal(body.achiever_details.last_name, 'Name');
  assert.equal(body.organization_detail.name, 'PII Redaction Test Org');
  assert.equal(body.organization_detail.city, 'Org City');
  assert.equal(body.organization_detail.state, 'Org State');
  assert.equal(body.organization_detail.country, 'Org Country');
  assert.equal(body.integrity_valid, true);

  // The actual fix: none of this reaches an unauthenticated caller.
  assert.equal(body.achiever_details.designation, undefined, 'recipient job title must not be exposed publicly');
  assert.equal(body.achiever_details.city, undefined, 'recipient city must not be exposed publicly');
  assert.equal(body.organization_detail.support_email, undefined, 'organization support email must not be exposed publicly');
  assert.equal(body.organization_detail.support_phone, undefined, 'organization support phone must not be exposed publicly');
});

test('the cached response (second request within the 60s TTL) is also redacted, not just the first, freshly-computed one', async () => {
  const { getCredentialByCode } = require('../controllers/credentialController');
  const credential_code = await issueCredentialWithFullDetails();

  const firstRes = responseDouble();
  await getCredentialByCode({ params: { credential_code } }, firstRes);
  assert.equal(firstRes.statusCode, 200);

  const secondRes = responseDouble();
  await getCredentialByCode({ params: { credential_code } }, secondRes);
  assert.equal(secondRes.statusCode, 200);

  assert.equal(secondRes.body.achiever_details.designation, undefined);
  assert.equal(secondRes.body.organization_detail.support_email, undefined);
});

test('GET /by-code/openbadge does not include the organization\'s support email in the issuer profile', async () => {
  const { getCredentialAsOpenBadge } = require('../controllers/credentialController');
  const credential_code = await issueCredentialWithFullDetails();

  const res = responseDouble();
  await getCredentialAsOpenBadge({ params: { credential_code } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.issuer.email, undefined);
  assert.equal(res.body.issuer.name, 'PII Redaction Test Org');
});
