// tests/openBadge.integration.test.js
//
// Real integration test (real MongoDB via mongodb-memory-server) for the
// Open Badges 3.0 export endpoint. Verifies the response is structurally
// a valid OB3.0 AchievementCredential -- required @context/type/issuer/
// credentialSubject/achievement/proof fields -- built from a credential
// issued the normal way (createCredential), not a hand-crafted fixture.
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

async function issueRealCredential() {
  const { createCredential } = require('../controllers/credentialController');
  const Organization = require('../models/organization_schema');

  // Idempotent -- this helper is called from more than one test.
  await Organization.findOneAndUpdate(
    { organization_code: 'OB-ORG' },
    {
      organization_code: 'OB-ORG',
      name: 'Open Badge Test Org',
      city: 'City', state: 'State', country: 'Country',
      email: 'ob-org@example.com', phone: '555-1000', status: 'ACTIVE',
    },
    { upsert: true }
  );

  const req = {
    user: { organization_code: 'OB-ORG', username: 'admin-ob' },
    body: {
      credential_pic_url: 'http://localhost:9000/uploads/ob-cert.png',
      achiever_username: 'Jamie Doe',
      credential_title: 'Certified Widget Operator',
      guest_recipient: {
        email: 'jamie.doe@example.com',
        first_name: 'Jamie',
        last_name: 'Doe',
      },
    },
  };
  const res = responseDouble();
  await createCredential(req, res);
  assert.equal(res.statusCode, 201);
  return res.body.credential_code;
}

test('GET /by-code/:code/openbadge returns a structurally valid OB3.0 AchievementCredential', async () => {
  const { getCredentialAsOpenBadge } = require('../controllers/credentialController');
  const credential_code = await issueRealCredential();

  const req = { params: { credential_code } };
  const res = responseDouble();
  await getCredentialAsOpenBadge(req, res);

  assert.equal(res.statusCode, 200);
  const badge = res.body;

  // @context must include both the base VC 2.0 context and the OB3.0 context
  assert.ok(Array.isArray(badge['@context']));
  assert.ok(badge['@context'].includes('https://www.w3.org/ns/credentials/v2'));
  assert.ok(badge['@context'].some((c) => c.includes('ob/v3p0')));

  assert.ok(badge.type.includes('VerifiableCredential'));
  assert.ok(badge.type.includes('OpenBadgeCredential'));

  assert.equal(badge.issuer.name, 'Open Badge Test Org');
  assert.ok(badge.issuer.id.includes('OB-ORG'));

  // Dates must be real, parseable ISO 8601, and validUntil after validFrom
  assert.ok(!Number.isNaN(Date.parse(badge.validFrom)));
  assert.ok(!Number.isNaN(Date.parse(badge.validUntil)));
  assert.ok(Date.parse(badge.validUntil) > Date.parse(badge.validFrom));

  assert.equal(badge.credentialSubject.type[0], 'AchievementSubject');
  assert.equal(badge.credentialSubject.name, 'Jamie Doe');
  assert.equal(badge.credentialSubject.achievement.name, 'Certified Widget Operator');
  assert.ok(badge.credentialSubject.achievement.criteria.narrative.includes('Jamie Doe'));

  assert.equal(badge.proof.type, 'DataIntegrityProof');
  assert.equal(typeof badge.proof.proofValue, 'string');
  assert.equal(badge.proof.proofValue.length, 64); // sha256 hex digest
});

test('GET /by-code/:code/openbadge returns 404 for an unknown credential code', async () => {
  const { getCredentialAsOpenBadge } = require('../controllers/credentialController');
  const req = { params: { credential_code: 'DOES-NOT-EXIST' } };
  const res = responseDouble();
  await getCredentialAsOpenBadge(req, res);
  assert.equal(res.statusCode, 404);
});

test('the OB3.0 proof.proofValue matches the same integrity hash already stored on the credential (no issuer keypair configured)', async () => {
  // Explicit regardless of test order within this file -- this test's
  // whole point is the no-keypair-configured fallback path.
  delete process.env.OB3_ISSUER_PRIVATE_KEY_PEM;
  const { getCredentialAsOpenBadge } = require('../controllers/credentialController');
  const Credential = require('../models/credentialSchema');
  const credential_code = await issueRealCredential();

  const stored = await Credential.findOne({ credential_code });
  const req = { params: { credential_code } };
  const res = responseDouble();
  await getCredentialAsOpenBadge(req, res);

  assert.equal(res.body.proof.cryptosuite, 'ebadgeid-sha256-integrity-2024');
  assert.equal(res.body.proof.proofValue, stored.credential_blockchain_hashes);
});

test('with a real issuer keypair configured, the OB3.0 export carries a real eddsa-jcs-2022 signature that verifies', async () => {
  const { generateIssuerKeypair, verifyCredentialSignature } = require('../utils/openBadgeSigning');
  const { privateKeyPem, publicKeyMultibase } = generateIssuerKeypair();
  process.env.OB3_ISSUER_PRIVATE_KEY_PEM = privateKeyPem;
  try {
    const { getCredentialAsOpenBadge } = require('../controllers/credentialController');
    const credential_code = await issueRealCredential();
    const req = { params: { credential_code } };
    const res = responseDouble();
    await getCredentialAsOpenBadge(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.proof.cryptosuite, 'eddsa-jcs-2022');
    assert.ok(res.body.proof.verificationMethod.includes(publicKeyMultibase));

    const valid = await verifyCredentialSignature(res.body, publicKeyMultibase);
    assert.equal(valid, true, 'the real endpoint response must verify against the real public key');
  } finally {
    delete process.env.OB3_ISSUER_PRIVATE_KEY_PEM;
  }
});

// The real HTTP route from api.js, extracted into a standalone Express
// app for testing (api.js itself wires up the whole application --
// mongoose connection, every other router -- too much to boot just to
// check one route's response shape). Same handler logic, verbatim.
function buildDidDocumentApp() {
  const express = require('express');
  const app = express();
  app.get('/.well-known/did.json', (req, res) => {
    const { isConfigured, loadIssuerKeyPair, verificationMethodId } = require('../utils/openBadgeSigning');
    if (!isConfigured()) {
      return res.status(404).json({ message: 'No issuer keypair is configured on this deployment (OB3_ISSUER_PRIVATE_KEY_PEM)' });
    }
    const appBaseUrl = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
    const { publicKeyMultibase } = loadIssuerKeyPair();
    const did = `did:web:${appBaseUrl.replace(/^https?:\/\//, '').replace(/:/g, '%3A')}`;
    const verificationMethod = verificationMethodId(appBaseUrl, publicKeyMultibase);
    res.json({
      '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
      id: did,
      verificationMethod: [{ id: verificationMethod, type: 'Multikey', controller: did, publicKeyMultibase }],
      assertionMethod: [verificationMethod],
    });
  });
  return app;
}

test('GET /.well-known/did.json returns 404 when no issuer keypair is configured', async () => {
  const request = require('supertest');
  delete process.env.OB3_ISSUER_PRIVATE_KEY_PEM;
  const res = await request(buildDidDocumentApp()).get('/.well-known/did.json');
  assert.equal(res.status, 404);
});

test('GET /.well-known/did.json serves the real public key once a keypair is configured, and it matches what was signed with', async () => {
  const request = require('supertest');
  const { generateIssuerKeypair } = require('../utils/openBadgeSigning');
  const { privateKeyPem, publicKeyMultibase } = generateIssuerKeypair();
  process.env.OB3_ISSUER_PRIVATE_KEY_PEM = privateKeyPem;
  try {
    const res = await request(buildDidDocumentApp()).get('/.well-known/did.json');
    assert.equal(res.status, 200);
    assert.equal(res.body.verificationMethod[0].publicKeyMultibase, publicKeyMultibase);
    assert.equal(res.body.verificationMethod[0].type, 'Multikey');
    assert.ok(res.body.assertionMethod[0].includes(publicKeyMultibase));
  } finally {
    delete process.env.OB3_ISSUER_PRIVATE_KEY_PEM;
  }
});
