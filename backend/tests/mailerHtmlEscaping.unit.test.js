// tests/mailerHtmlEscaping.unit.test.js
//
// E2E audit finding H-03: sendInvitationEmail's jobTitle and
// sendWelcomeEmail's fullName used to be interpolated into the HTML body
// with no escaping at all, unlike services/emailService.js. Both now
// reuse that same escapeHtml(). Real invocation of the real functions,
// with only the network-sending step (transporter.sendMail, already
// exported "for testing purposes") stubbed out -- no real SMTP call.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sendInvitationEmail, sendWelcomeEmail, transporter } = require('../utils/mailer');

test('sendInvitationEmail escapes HTML-looking characters in the designation before they reach the email body', async () => {
  let capturedHtml = '';
  const originalSendMail = transporter.sendMail;
  transporter.sendMail = async (mailOptions) => {
    capturedHtml = mailOptions.html;
    return { messageId: 'test-message-id' };
  };
  try {
    await sendInvitationEmail('someone@example.test', '<img src=x onerror=alert(1)>', 'INV-TEST-CODE');
  } finally {
    transporter.sendMail = originalSendMail;
  }
  assert.doesNotMatch(capturedHtml, /<img src=x onerror=alert\(1\)>/, 'the raw payload must never appear unescaped in the sent HTML');
  assert.match(capturedHtml, /&lt;img src=x onerror=alert\(1\)&gt;/, 'it must appear HTML-escaped instead');
});

test('sendWelcomeEmail escapes HTML-looking characters in the full name before they reach the email body', async () => {
  let capturedHtml = '';
  const originalSendMail = transporter.sendMail;
  transporter.sendMail = async (mailOptions) => {
    capturedHtml = mailOptions.html;
    return { messageId: 'test-message-id' };
  };
  try {
    await sendWelcomeEmail('someone@example.test', '<script>alert(document.cookie)</script>');
  } finally {
    transporter.sendMail = originalSendMail;
  }
  assert.doesNotMatch(capturedHtml, /<script>alert\(document\.cookie\)<\/script>/);
  assert.match(capturedHtml, /&lt;script&gt;alert\(document\.cookie\)&lt;\/script&gt;/);
});

test('a normal, safe designation/name still renders exactly as written (escaping does not mangle plain text)', async () => {
  let capturedHtml = '';
  const originalSendMail = transporter.sendMail;
  transporter.sendMail = async (mailOptions) => {
    capturedHtml = mailOptions.html;
    return { messageId: 'test-message-id' };
  };
  try {
    await sendInvitationEmail('someone@example.test', 'Senior Engineer', 'INV-TEST-CODE-2');
  } finally {
    transporter.sendMail = originalSendMail;
  }
  assert.match(capturedHtml, /Senior Engineer/);
});
