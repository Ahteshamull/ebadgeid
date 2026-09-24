// tests/bulk-csv-utils.test.mjs
//
// Covers the bulk-issue CSV parser (ronda 18) — the legacy "one username
// per line" format, the header-driven format that mixes real usernames
// with guest recipients in the same file, and the per-row error messages
// a malformed guest row should produce.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitCsvLine, parseBulkRecipients, detectCsvColumns } from '../src/lib/bulk-csv-utils.mjs';

test('splitCsvLine splits plain comma-separated values', () => {
  assert.deepEqual(splitCsvLine('a,b,c'), ['a', 'b', 'c']);
});

test('splitCsvLine keeps a comma inside quotes as part of the field', () => {
  assert.deepEqual(splitCsvLine('john,"San Francisco, CA",doe'), ['john', 'San Francisco, CA', 'doe']);
});

test('splitCsvLine unescapes doubled quotes inside a quoted field', () => {
  assert.deepEqual(splitCsvLine('"She said ""hi""",ok'), ['She said "hi"', 'ok']);
});

test('legacy format: no recognized header treats every line as a bare username', () => {
  const { recipients, errors } = parseBulkRecipients('alice\nbob\ncarol');
  assert.deepEqual(recipients, [
    { achiever_username: 'alice' },
    { achiever_username: 'bob' },
    { achiever_username: 'carol' },
  ]);
  assert.deepEqual(errors, []);
});

test('legacy format skips blank lines', () => {
  const { recipients } = parseBulkRecipients('alice\n\n\nbob\n');
  assert.deepEqual(recipients.map(r => r.achiever_username), ['alice', 'bob']);
});

test('empty input yields no recipients and no errors', () => {
  // Asserts the two fields rather than the whole object: the return value
  // deliberately also carries header/mapping/unmapped now, for the
  // column-mapping step. The behaviour under test -- empty in, nothing
  // out, no complaint -- is unchanged.
  for (const input of ['', '\n\n']) {
    const result = parseBulkRecipients(input);
    assert.deepEqual(result.recipients, []);
    assert.deepEqual(result.errors, []);
  }
});

test('header-driven CSV: a row with username is issued as an existing account', () => {
  const csv = 'username,email,first_name,last_name\nalice,,,\n';
  const { recipients, errors } = parseBulkRecipients(csv);
  assert.deepEqual(recipients, [{ achiever_username: 'alice' }]);
  assert.deepEqual(errors, []);
});

test('header-driven CSV: a row with no username but a real email is issued as a guest', () => {
  const csv = 'username,email,first_name,last_name,designation,city\n,guest@example.com,Jane,Doe,Engineer,"Austin, TX"\n';
  const { recipients, errors } = parseBulkRecipients(csv);
  assert.deepEqual(errors, []);
  assert.equal(recipients.length, 1);
  assert.equal(recipients[0].achiever_username, 'Jane Doe');
  assert.deepEqual(recipients[0].guest_recipient, {
    email: 'guest@example.com',
    first_name: 'Jane',
    last_name: 'Doe',
    designation: 'Engineer',
    city: 'Austin, TX',
  });
});

test('header-driven CSV: usernames and guests can be mixed freely in the same file', () => {
  const csv = [
    'username,email,first_name,last_name',
    'alice,,,',
    ',guest@example.com,Jane,Doe',
    'bob,,,',
  ].join('\n');
  const { recipients, errors } = parseBulkRecipients(csv);
  assert.deepEqual(errors, []);
  assert.equal(recipients.length, 3);
  assert.equal(recipients[0].achiever_username, 'alice');
  assert.equal(recipients[0].guest_recipient, undefined);
  assert.equal(recipients[1].achiever_username, 'Jane Doe');
  assert.ok(recipients[1].guest_recipient);
  assert.equal(recipients[2].achiever_username, 'bob');
});

test('header-driven CSV: a row with neither username nor email is a per-row error, not a thrown exception', () => {
  const csv = 'username,email,first_name,last_name\n,,,\n';
  const { recipients, errors } = parseBulkRecipients(csv);
  assert.deepEqual(recipients, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /neither a username nor an email/);
});

test('header-driven CSV: an invalid email is rejected with a row-specific error', () => {
  const csv = 'username,email,first_name,last_name\n,not-an-email,Jane,Doe\n';
  const { recipients, errors } = parseBulkRecipients(csv);
  assert.deepEqual(recipients, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not a valid email address/);
});

test('header-driven CSV: a guest row missing first_name or last_name is rejected, not silently issued', () => {
  const csv = 'username,email,first_name,last_name\n,guest@example.com,Jane,\n';
  const { recipients, errors } = parseBulkRecipients(csv);
  assert.deepEqual(recipients, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /needs first_name and last_name/);
});

test('header detection is case-insensitive and order-independent', () => {
  const csv = 'Email,Username\nguest2@example.com,\n';
  // No first_name/last_name column at all -> the guest row is rejected,
  // but this still must be recognized as header-driven (not fall back to
  // the legacy per-line format, which would wrongly treat the header row
  // itself as a username).
  const { recipients, errors } = parseBulkRecipients(csv);
  assert.deepEqual(recipients, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /needs first_name and last_name/);
});

// --- Header aliases and column mapping ------------------------------------
// Header matching used to be exact-string only. A spreadsheet exported from
// a Spanish-language system matched nothing, fell through to the legacy
// one-username-per-line branch, and turned every whole CSV line into a
// username -- a batch of nonsense credentials that consumed real plan
// quota with no error shown. These pin both halves of the fix: the aliases
// that make ordinary files just work, and the refusal that replaced the
// silent misparse when they don't.

test('a Spanish-language header is recognized instead of being misread as usernames', () => {
  const { recipients, errors } = parseBulkRecipients(
    'Nombre,Apellido,Correo\nJane,Smith,jane@example.com'
  );
  assert.deepEqual(errors, []);
  assert.equal(recipients.length, 1);
  assert.equal(recipients[0].achiever_username, 'Jane Smith');
  assert.equal(recipients[0].guest_recipient.email, 'jane@example.com');
  // The old behaviour: the whole line "Jane,Smith,jane@example.com" became
  // one username. Prove that specific corruption is gone.
  assert.ok(!recipients[0].achiever_username.includes(','));
});

test('header matching ignores case, accents and separator punctuation', () => {
  const { recipients, errors } = parseBulkRecipients(
    'First_Name,LAST-NAME,Correo Electrónico\nAda,Lovelace,ada@example.com'
  );
  assert.deepEqual(errors, []);
  assert.equal(recipients[0].guest_recipient.email, 'ada@example.com');
  assert.equal(recipients[0].guest_recipient.first_name, 'Ada');
  assert.equal(recipients[0].guest_recipient.last_name, 'Lovelace');
});

test('a multi-column file whose headers cannot be mapped is refused, not misread', () => {
  const result = parseBulkRecipients('Columna A,Columna B\nfoo,bar');
  assert.equal(result.recipients.length, 0, 'nothing may be issued from an unmapped file');
  assert.equal(result.needsMapping, true);
  assert.deepEqual(result.header, ['Columna A', 'Columna B']);
  assert.ok(result.errors.length > 0);
});

test('an explicit mapping from the admin overrides detection', () => {
  const result = parseBulkRecipients(
    'Columna A,Columna B,Columna C\nAda,Lovelace,ada@example.com',
    { mapping: { first_name: 0, last_name: 1, email: 2 } }
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.recipients.length, 1);
  assert.equal(result.recipients[0].guest_recipient.email, 'ada@example.com');
});

test('the legacy one-username-per-line file still parses exactly as before', () => {
  const { recipients, errors } = parseBulkRecipients('jdoe\nasmith\nbrown');
  assert.deepEqual(errors, []);
  assert.deepEqual(recipients.map(r => r.achiever_username), ['jdoe', 'asmith', 'brown']);
});

test('unmapped columns are reported so their data is never silently dropped', () => {
  const { mapping, unmapped } = detectCsvColumns(['username', 'Departamento', 'email']);
  assert.equal(mapping.username, 0);
  assert.equal(mapping.email, 2);
  assert.deepEqual(unmapped, ['Departamento']);
});

test('two headers matching the same field do not overwrite each other', () => {
  const { mapping } = detectCsvColumns(['nombre', 'name']);
  assert.equal(mapping.first_name, 0, 'the first match wins');
  assert.notEqual(mapping.last_name, 0);
});
