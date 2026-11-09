// tests/testHelpers/stubEmailTransport.js
//
// Resend -> SMTP migration (product owner's explicit choice: no
// third-party email API, everything goes out over the real SMTP mailbox
// configured as EMAIL_USER -- see utils/smtpTransporter.js). Before this
// migration, RESEND_API_KEY was simply blank in this environment, so
// every credential-issued/contract/welcome email failed closed instantly
// with no network call at all -- tests never had to think about it. Now
// that EMAIL_HOST/EMAIL_USER/EMAIL_PASS are real, working credentials,
// any test that reaches one of those code paths for real would otherwise
// attempt a genuine SMTP connection using the real mailbox. Stub
// transporter.sendMail (the exact mechanism tests/mailerHtmlEscaping.
// unit.test.js already uses for utils/mailer.js) so no test ever sends a
// real email, regardless of what it's actually asserting.
const { transporter } = require('../../utils/smtpTransporter');

function stubEmailTransport() {
  const original = transporter.sendMail;
  const sent = [];
  transporter.sendMail = async (mailOptions) => {
    sent.push(mailOptions);
    return { messageId: `stubbed-${sent.length}` };
  };
  return {
    sent,
    restore() {
      transporter.sendMail = original;
    },
  };
}

module.exports = { stubEmailTransport };
