// utils/smtpTransporter.js
//
// The one real email transport for this backend -- previously
// utils/mailer.js (invitations, welcome) had its own transporter and
// services/emailService.js + controllers/credentialController.js used
// Resend instead, for contracts and credential-issued notifications
// respectively. By explicit choice of the product owner, all outbound
// email now goes out over this same SMTP mailbox (info@ebadgeid.com,
// already configured as EMAIL_USER -- confirmed as the definitive sender,
// not a placeholder) instead of a third-party API -- this
// module exists so there is exactly one place that knows how to connect
// to it, and exactly one `transporter` object every caller shares (so
// tests can stub `transporter.sendMail` once and it covers every sender).
//
// nodemailer's `service: 'Gmail'` shorthand hardcodes Google's own SMTP
// host/port and ignores any custom server entirely -- so this always
// tried to authenticate against Gmail, even for a mailbox hosted
// elsewhere (e.g. a business domain's own mail.<domain> server). Any
// EMAIL_USER/EMAIL_PASS for a non-Gmail mailbox would fail here no
// matter how correct the credentials were. If EMAIL_HOST is set, connect
// to that real SMTP server directly; otherwise keep the Gmail-shorthand
// behavior so nothing changes for a deployment that was already relying
// on it.
const nodemailer = require('nodemailer');

const transporter = process.env.EMAIL_HOST
  ? nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT) || 465,
      secure: process.env.EMAIL_SECURE !== 'false', // true (465/SSL) unless explicitly disabled
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    })
  : nodemailer.createTransport({
      service: 'Gmail', // or use 'SendGrid', 'Mailgun' -- set EMAIL_HOST instead for a custom SMTP server
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

// Reliability fix, found during an audit round: every caller of
// transporter.sendMail across this codebase (services/emailService.js's
// 11 call sites, utils/mailer.js) follows the same "try, log the error,
// and continue" pattern -- correct for not blocking a real HTTP response
// on outbound email, but it meant a single transient SMTP hiccup (a brief
// network blip, the mailbox's own rate limiting) permanently lost that
// one notification with no second attempt. Wrapped once, here, so every
// caller gets it for free without 11 separate call sites each
// reimplementing retry logic -- same MAX_ATTEMPTS/exponential-backoff
// shape services/lmsSync.js already uses for outbound HTTP, for
// consistency. Callers' own try/catch is unchanged: this still throws
// (and callers still log-and-continue) if every attempt fails, so
// "notification failures never block the real request" stays true --
// this only reduces how often a single transient blip alone is what
// causes that.
const MAX_SEND_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rawSendMail = transporter.sendMail.bind(transporter);
transporter.sendMail = async (...args) => {
  let lastError;
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
    try {
      return await rawSendMail(...args);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_SEND_ATTEMPTS) await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError;
};

module.exports = { transporter };
