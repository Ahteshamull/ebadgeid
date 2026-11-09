// tests/invitationFlow.unit.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const encryptionService = require('../utils/cryptoHelper');

test('encryptionService generates and verifies valid invitation tokens', () => {
  const email = 'employee@company.test';
  const orgCode = 'TEST_ORG_01';
  const sixDigitCode = '654321';
  const designation = 'Senior Software Engineer';

  const token = encryptionService.generateInvitationToken(email, orgCode, sixDigitCode, designation);
  assert.ok(typeof token === 'string' && token.startsWith('v2.'));

  const result = encryptionService.verifyInvitationToken(token);
  assert.equal(result.isValid, true);
  assert.equal(result.email, email);
  assert.equal(result.orgCode, orgCode);
  assert.equal(result.sixDigitCode, sixDigitCode);
  assert.equal(result.designation, designation);
});

test('encryptionService rejects tampered or expired tokens gracefully without throwing unhandled exceptions', () => {
  const result1 = encryptionService.verifyInvitationToken('invalid-token-string');
  assert.equal(result1.isValid, false);

  const result2 = encryptionService.verifyInvitationToken('v2.badiv.badtag.badciphertext');
  assert.equal(result2.isValid, false);
});
