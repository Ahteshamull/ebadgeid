const nodemailer = require("nodemailer");

// Shared by sendEmail.js (OTP) and sendMail.js (generic) — both used to
// build their own nodemailer transporter from the same GMAIL_USER/GMAIL_PASS
// pair independently, which was the only real duplication between those two
// files (their actual sending logic is genuinely different: one is a fixed
// OTP template, the other is a generic to/subject/text mailer, and both have
// real, distinct consumers — otpController.js and authController.js — so
// neither file was safe to just delete). One transporter, reused by both.
const gmailTransporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

module.exports = gmailTransporter;
