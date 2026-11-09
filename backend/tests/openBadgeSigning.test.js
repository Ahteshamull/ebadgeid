// tests/openBadgeSigning.test.js
//
// Real Ed25519 crypto, no mocks — actual key generation, actual
// eddsa-jcs-2022 signing and verification, actual tamper detection.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateIssuerKeypair, isConfigured, loadIssuerKeyPair,
  signCredential, verifyCredentialSignature,
} = require('../utils/openBadgeSigning');

test('isConfigured() is false with no OB3_ISSUER_PRIVATE_KEY_PEM set', () => {
  delete process.env.OB3_ISSUER_PRIVATE_KEY_PEM;
  assert.equal(isConfigured(), false);
  assert.equal(loadIssuerKeyPair(), null);
});

test('generateIssuerKeypair() produces a real PEM private key and a multibase public key', () => {
  const { privateKeyPem, publicKeyMultibase } = generateIssuerKeypair();
  assert.match(privateKeyPem, /-----BEGIN PRIVATE KEY-----/);
  assert.match(publicKeyMultibase, /^z[1-9A-HJ-NP-Za-km-z]+$/); // 'z' + base58btc alphabet
});

test('signCredential() throws a clear error when no keypair is configured', async () => {
  delete process.env.OB3_ISSUER_PRIVATE_KEY_PEM;
  await assert.rejects(
    signCredential({ '@context': [] }, { verificationMethod: 'x' }),
    /not configured/
  );
});

test('a real credential round-trips: signed, then verified successfully with the matching public key', async () => {
  const { privateKeyPem, publicKeyMultibase } = generateIssuerKeypair();
  process.env.OB3_ISSUER_PRIVATE_KEY_PEM = privateKeyPem;

  const credential = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json'],
    id: 'https://example.test/verifications/credentials/CRED-1',
    type: ['VerifiableCredential', 'OpenBadgeCredential'],
    name: 'Certified Widget Operator',
    credentialSubject: { type: ['AchievementSubject'], name: 'Jamie Doe' },
  };

  const proof = await signCredential(credential, {
    verificationMethod: `https://example.test/.well-known/did.json#${publicKeyMultibase}`,
  });

  assert.equal(proof.type, 'DataIntegrityProof');
  assert.equal(proof.cryptosuite, 'eddsa-jcs-2022');
  assert.match(proof.proofValue, /^z/);

  const secured = { ...credential, proof };
  const valid = await verifyCredentialSignature(secured, publicKeyMultibase);
  assert.equal(valid, true);
});

test('tampering with any field of a signed credential invalidates the signature', async () => {
  const { privateKeyPem, publicKeyMultibase } = generateIssuerKeypair();
  process.env.OB3_ISSUER_PRIVATE_KEY_PEM = privateKeyPem;

  const credential = { '@context': [], id: 'https://example.test/cred/2', name: 'Original Name' };
  const proof = await signCredential(credential, { verificationMethod: 'https://example.test/.well-known/did.json#key' });
  const secured = { ...credential, proof };

  const tampered = { ...secured, name: 'Tampered Name' };
  assert.equal(await verifyCredentialSignature(tampered, publicKeyMultibase), false);
});

test('a signature from one keypair does not verify against a different keypair\'s public key', async () => {
  const keyA = generateIssuerKeypair();
  const keyB = generateIssuerKeypair();
  assert.notEqual(keyA.publicKeyMultibase, keyB.publicKeyMultibase);

  process.env.OB3_ISSUER_PRIVATE_KEY_PEM = keyA.privateKeyPem;
  const credential = { '@context': [], id: 'https://example.test/cred/3', name: 'Cross-key test' };
  const proof = await signCredential(credential, { verificationMethod: 'https://example.test/.well-known/did.json#key' });
  const secured = { ...credential, proof };

  assert.equal(await verifyCredentialSignature(secured, keyA.publicKeyMultibase), true);
  assert.equal(await verifyCredentialSignature(secured, keyB.publicKeyMultibase), false);
});

test('loadIssuerKeyPair() re-derives the same public key every time from the same private key', () => {
  const { privateKeyPem, publicKeyMultibase } = generateIssuerKeypair();
  process.env.OB3_ISSUER_PRIVATE_KEY_PEM = privateKeyPem;
  const first = loadIssuerKeyPair();
  const second = loadIssuerKeyPair();
  assert.equal(first.publicKeyMultibase, publicKeyMultibase);
  assert.equal(first.publicKeyMultibase, second.publicKeyMultibase);
});
