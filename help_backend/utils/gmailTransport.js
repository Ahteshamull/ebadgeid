const nodemailer = require("nodemailer");

// Same shape as backend/utils/smtpTransporter.js: if SMTP_HOST is set,
// connect to that server (Gmail in this project). Auth is required for
// Gmail; Mailpit (127.0.0.1:1025) works without it.
const smtpHost = process.env.SMTP_HOST || process.env.EMAIL_HOST;
const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER || process.env.GMAIL_USER;
const smtpPass = process.env.SMTP_PASSWORD || process.env.EMAIL_PASS || process.env.GMAIL_PASS;
const smtpPort = Number.parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '465', 10);
const secureFlag = process.env.SMTP_SECURE ?? process.env.EMAIL_SECURE;
const smtpSecure = secureFlag !== 'false' && smtpPort !== 1025;

const transportConfig = smtpHost
  ? {
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      ...(smtpUser && smtpPass ? { auth: { user: smtpUser, pass: smtpPass } } : {}),
    }
  : {
      service: "gmail",
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    };

module.exports = nodemailer.createTransport(transportConfig);
