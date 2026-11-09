// tests/customFields.unit.test.js
//
// Pure unit tests for utils/customFields.js -- the one place both
// certificateController.generateCertificate (burns values into the
// rendered image) and credentialController.createCredential (persists them
// on the issued credential) validate an org-defined custom field payload,
// so a gap here would be a gap in both.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeCustomFields, MAX_FIELDS, MAX_VALUE_LENGTH } = require('../utils/customFields');

test('undefined/null custom_fields sanitizes to an empty object, not an error', () => {
  assert.deepEqual(sanitizeCustomFields(undefined), {});
  assert.deepEqual(sanitizeCustomFields(null), {});
});

test('a plain object of string/number values passes through, numbers coerced to strings', () => {
  const result = sanitizeCustomFields({ course_name: 'Advanced Docker', score: 98 });
  assert.deepEqual(result, { course_name: 'Advanced Docker', score: '98' });
});

test('recipient_name is silently dropped -- achiever_username is always the single source of truth for it', () => {
  const result = sanitizeCustomFields({ recipient_name: 'Someone Else', course_name: 'Docker' });
  assert.deepEqual(result, { course_name: 'Docker' });
});

test('null/undefined-valued keys are dropped rather than stored as the string "null"', () => {
  const result = sanitizeCustomFields({ course_name: 'Docker', empty_field: null, also_empty: undefined });
  assert.deepEqual(result, { course_name: 'Docker' });
});

test('a non-object payload (array or primitive) is rejected', () => {
  assert.throws(() => sanitizeCustomFields(['not', 'an', 'object']), /must be an object/);
  assert.throws(() => sanitizeCustomFields('a string'), /must be an object/);
});

test('a non-string/number value is rejected with the offending field name in the message', () => {
  assert.throws(() => sanitizeCustomFields({ course_name: { nested: true } }), /custom_fields\.course_name must be a string or number/);
});

test(`more than ${MAX_FIELDS} fields is rejected`, () => {
  const tooMany = Object.fromEntries(Array.from({ length: MAX_FIELDS + 1 }, (_, i) => [`field_${i}`, 'x']));
  assert.throws(() => sanitizeCustomFields(tooMany), new RegExp(`cannot have more than ${MAX_FIELDS}`));
});

test(`a value longer than ${MAX_VALUE_LENGTH} characters is truncated, not rejected`, () => {
  const longValue = 'x'.repeat(MAX_VALUE_LENGTH + 50);
  const result = sanitizeCustomFields({ notes: longValue });
  assert.equal(result.notes.length, MAX_VALUE_LENGTH);
});

test('keys are trimmed', () => {
  const result = sanitizeCustomFields({ '  course_name  ': 'Docker' });
  assert.deepEqual(result, { course_name: 'Docker' });
});
