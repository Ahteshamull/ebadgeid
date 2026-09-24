// tests/certificatePlaceholders.test.js
//
// Every one of the eight built-in certificate templates carries the text
// "Issued on {{issue_date}}". Nothing substituted it, so each certificate
// was issued with the literal string {{issue_date}} printed on the image --
// the thing the recipient sees, downloads and shares. It was invisible in
// code review and in every test, because the placeholder lives in template
// DATA, not in the renderer; it only showed up when an actually issued
// certificate image was opened and read.
const test = require('node:test');
const assert = require('node:assert/strict');

const { fillPlaceholders } = require('../controllers/certificateController');

test('the placeholder the template library actually uses is filled in', () => {
  const out = fillPlaceholders('Issued on {{issue_date}}', { issue_date: '2026-08-31' });
  assert.equal(out, 'Issued on 2026-08-31');
  assert.ok(!out.includes('{{'), 'no placeholder syntax may survive onto a real certificate');
});

test('whitespace and casing inside the braces still match', () => {
  assert.equal(fillPlaceholders('{{ issue_date }}', { issue_date: 'X' }), 'X');
  assert.equal(fillPlaceholders('{{ISSUE_DATE}}', { issue_date: 'X' }), 'X');
});

test('several placeholders in one string are all filled', () => {
  const out = fillPlaceholders('{{recipient_name}} — {{credential_id}} — {{issue_date}}', {
    recipient_name: 'Ada', credential_id: 'CRED-1', issue_date: '2026-08-31',
  });
  assert.equal(out, 'Ada — CRED-1 — 2026-08-31');
});

test('an unknown placeholder is left visible rather than silently blanked', () => {
  // A mistyped token must be obvious in the preview. Blanking it would put
  // an unexplained empty gap on a real credential instead.
  assert.equal(fillPlaceholders('Hola {{no_existe}}', { issue_date: 'X' }), 'Hola {{no_existe}}');
});

test('ordinary text is returned untouched', () => {
  for (const value of ['Certificate of Achievement', '', 'sin llaves']) {
    assert.equal(fillPlaceholders(value, { issue_date: 'X' }), value);
  }
});

test('a non-string is passed through rather than throwing', () => {
  // text_attributes come from stored documents; a malformed one must not
  // take down issuance for the whole batch.
  for (const value of [undefined, null, 42]) {
    assert.equal(fillPlaceholders(value, {}), value);
  }
});
