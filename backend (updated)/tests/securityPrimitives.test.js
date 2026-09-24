const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const ContractAccess = require('../models/contractAccess');
const ApiKey = require('../models/api_keys');

test('contract access secrets are hashed before validation and omitted from JSON', async () => {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const record = new ContractAccess({
    contract_code: 'CONTRACT-1',
    access_token: rawToken,
    issued_to_email: 'party@example.com',
    expires_at: new Date(Date.now() + 60_000),
  });
  await record.validate();
  assert.equal(record.access_token, undefined);
  assert.equal(record.access_token_hash, crypto.createHash('sha256').update(rawToken).digest('hex'));
  assert.equal(record.token_prefix, rawToken.slice(0, 8));
  assert.equal(record.toJSON().access_token_hash, undefined);
});

test('API key material is never serialized and a missing hash is rejected', async () => {
  const record = new ApiKey({
    api_key: 'legacy-secret',
    api_key_hash: crypto.createHash('sha256').update('legacy-secret').digest('hex'),
    valid_for: 30,
    organization_code: 'ORG-1',
    status: 'Active',
  });
  assert.equal(record.toJSON().api_key, undefined);
  assert.equal(record.toJSON().api_key_hash, undefined);
  await assert.rejects(new ApiKey({ valid_for: 30, organization_code: 'ORG-1', status: 'Active' }).validate(), /hash is required/i);
});

test('invitation encryption is randomized, round-trips, and rejects tampering', () => {
  const previous = process.env.ENCRYPTION_SECRET;
  process.env.ENCRYPTION_SECRET = 'test-secret-that-is-longer-than-thirty-two-bytes';
  delete require.cache[require.resolve('../utils/cryptoHelper')];
  const encryption = require('../utils/cryptoHelper');
  const first = encryption.generateInvitationToken('person@example.com', 'ORG-1', '123456', 'Engineer');
  const second = encryption.generateInvitationToken('person@example.com', 'ORG-1', '123456', 'Engineer');
  assert.notEqual(first, second);
  assert.deepEqual(encryption.verifyInvitationToken(first), {
    isValid: true,
    email: 'person@example.com',
    orgCode: 'ORG-1',
    sixDigitCode: '123456',
    designation: 'Engineer',
  });
  // Flip the last character's high bit rather than toggling blindly
  // between 'A'/'B' (values 0/1): base64url packs 3 bytes into 4 chars,
  // so a final group with 1 or 2 leftover bytes leaves the very last
  // character carrying only its top 2 or top 4 bits as real ciphertext
  // data (the rest is padding). 'A' and 'B' share the same top 2 bits
  // (both 0), so about 1 in 4 runs (whenever the real last character
  // happens to fall in that same padding-insensitive range) that swap
  // silently produced the exact same decoded bytes -- a flaky false pass
  // for "rejects tampering" that had nothing to do with the encryption
  // itself. XORing the alphabet index by its highest bit (32) always
  // changes a bit within whatever portion of the character is actually
  // significant, regardless of how many bits that is.
  const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const lastChar = first.slice(-1);
  const flippedChar = BASE64URL_ALPHABET[BASE64URL_ALPHABET.indexOf(lastChar) ^ 32];
  const tampered = `${first.slice(0, -1)}${flippedChar}`;
  assert.equal(encryption.verifyInvitationToken(tampered).isValid, false);
  if (previous === undefined) delete process.env.ENCRYPTION_SECRET;
  else process.env.ENCRYPTION_SECRET = previous;
});
