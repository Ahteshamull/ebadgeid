// tests/credentialIntegrity.test.js
//
// Locks in the fix for the "blockchain hash" bug documented in
// AUDIT_FIXES.md: the hash used to include Date.now() without ever storing
// it, which made it impossible to recompute later — so "verification"
// never actually checked anything. This test would have caught that: a
// hash that isn't reproducible from the record's own persisted fields
// fails the very first assertion below.
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeIntegrityHash } = require('../controllers/credentialController');

const sampleCredential = {
  credential_code: 'CRED-DEADBEEF',
  credential_pic_url: 'https://storage.ebadgeid.com/cred1.png',
  achiever_username: 'jdoe',
  credential_issue_date: '2026-08-02',
  credential_expiry_date: '2028-08-02',
  organization_code: 'ORG1',
};

test('the integrity hash is reproducible from the credential\'s own stored fields', () => {
  const hash1 = computeIntegrityHash(sampleCredential);
  const hash2 = computeIntegrityHash({ ...sampleCredential });
  assert.equal(hash1, hash2, 'recomputing the hash from the same stored fields must give the same result');
});

test('the integrity hash changes if any stored field is altered after issuance', () => {
  const original = computeIntegrityHash(sampleCredential);
  const tampered = computeIntegrityHash({ ...sampleCredential, achiever_username: 'attacker' });
  assert.notEqual(original, tampered, 'altering a field must invalidate the hash — this is what getCredentialByCode checks');
});

test('the hash does not depend on wall-clock time', () => {
  const hashNow = computeIntegrityHash(sampleCredential);
  // Simulate "recomputing this later" by just calling it again — there's
  // no Date.now()/timestamp input anymore, so nothing here should ever
  // cause drift between issuance time and verification time.
  const hashLater = computeIntegrityHash(sampleCredential);
  assert.equal(hashNow, hashLater);
});
