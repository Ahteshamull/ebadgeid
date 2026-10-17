import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVerificationUrl, isPreviewCode, mapCredentialStatus } from '../src/lib/verification-utils.mjs';

test('resolveVerificationUrl defaults to app.ebadgeid.com when origin is empty', () => {
  const url = resolveVerificationUrl('CRED-12345');
  assert.equal(url, 'https://app.ebadgeid.com/verifications/credentials/CRED-12345');
});

test('resolveVerificationUrl uses custom origin and trims trailing slash', () => {
  const url = resolveVerificationUrl('CRED-999', 'http://localhost:3000/');
  assert.equal(url, 'http://localhost:3000/verifications/credentials/CRED-999');
});

test('resolveVerificationUrl safely encodes special characters in credential code', () => {
  const url = resolveVerificationUrl('CRED/SPECIAL#1', 'https://app.ebadgeid.com');
  assert.equal(url, 'https://app.ebadgeid.com/verifications/credentials/CRED%2FSPECIAL%231');
});

test('isPreviewCode identifies PREVIEW code case-insensitively', () => {
  assert.equal(isPreviewCode('PREVIEW'), true);
  assert.equal(isPreviewCode('preview'), true);
  assert.equal(isPreviewCode(' Preview '), true);
  assert.equal(isPreviewCode('REAL-CREDENTIAL-123'), false);
  assert.equal(isPreviewCode(null), false);
  assert.equal(isPreviewCode(undefined), false);
});

test('mapCredentialStatus correctly identifies preview mode', () => {
  const result = mapCredentialStatus({ isPreview: true });
  assert.equal(result.statusType, 'preview');
  assert.equal(result.isAuthentic, true);
});

test('mapCredentialStatus identifies verified valid status for Issued and Claimed', () => {
  const issued = mapCredentialStatus({ status: 'Issued', integrityStatus: 'verified' });
  assert.equal(issued.statusType, 'valid');
  assert.equal(issued.isAuthentic, true);

  const claimed = mapCredentialStatus({ status: 'Claimed', integrityStatus: 'verified' });
  assert.equal(claimed.statusType, 'valid');
  assert.equal(claimed.isAuthentic, true);
});

test('mapCredentialStatus correctly handles Revoked status', () => {
  const revoked = mapCredentialStatus({ status: 'Revoked', integrityStatus: 'verified' });
  assert.equal(revoked.statusType, 'revoked');
  assert.equal(revoked.isAuthentic, false);
});

test('mapCredentialStatus correctly handles Expired status', () => {
  const expired = mapCredentialStatus({ status: 'Expired', integrityStatus: 'verified' });
  assert.equal(expired.statusType, 'expired');
  assert.equal(expired.isAuthentic, false);
});

test('mapCredentialStatus prioritizes integrity hash failure over other statuses', () => {
  const tampered = mapCredentialStatus({ status: 'Issued', integrityStatus: 'failed' });
  assert.equal(tampered.statusType, 'integrity_failed');
  assert.equal(tampered.isAuthentic, false);
});
