// tests/invitationTemplate.unit.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateInvitationEmailTemplate } = require('../templates/invitationEmailTemplate');

test('generateInvitationEmailTemplate returns valid subject, html, and plain text', () => {
  const result = generateInvitationEmailTemplate({
    recipientEmail: 'sarah@example.com',
    designation: 'Lead Developer',
    invitationCode: 'TEST-INV-12345',
    appBaseUrl: 'https://app.ebadgeid.com',
    organizationName: 'Acme Corp',
  });

  assert.ok(result.subject.includes('Lead Developer'));
  assert.ok(result.subject.includes('Acme Corp'));
  assert.ok(result.html.includes('https://app.ebadgeid.com/auth/self_signup/TEST-INV-12345'));
  assert.ok(result.html.includes('Lead Developer'));
  assert.ok(result.text.includes('https://app.ebadgeid.com/auth/self_signup/TEST-INV-12345'));
});

test('generateInvitationEmailTemplate escapes XSS payloads in parameters', () => {
  const result = generateInvitationEmailTemplate({
    recipientEmail: 'test<script>@example.com',
    designation: '<img src=x onerror=alert(1)>',
    invitationCode: 'SAFE-CODE',
    appBaseUrl: 'https://app.ebadgeid.com',
    organizationName: '<b onmouseover=evil()>Org</b>',
  });

  assert.doesNotMatch(result.html, /<img src=x onerror=alert\(1\)>/);
  assert.match(result.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(result.html, /<b onmouseover=evil\(\)>/);
  assert.match(result.html, /&lt;b onmouseover=evil\(\)&gt;/);
});
