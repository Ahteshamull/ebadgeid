const OtpToken = require("../models/OtpToken");
const User = require("../models/User");
const Organization = require("../models/organization");
const jwt = require("jsonwebtoken");
const { generateOtp } = require("../utils/OtpUtils");
const sendOtpEmail = require("../utils/sendEmail");
const crypto = require('crypto');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hashOtp = otp => crypto.createHmac('sha256', process.env.JWT_SECRET).update(String(otp)).digest('hex');
const normalizeIdentity = value => String(value || '').trim().toLowerCase();

function hashesMatch(storedHash, providedHash) {
  if (!storedHash || !providedHash) return false;
  const stored = Buffer.from(String(storedHash));
  const provided = Buffer.from(String(providedHash));
  return stored.length === provided.length && crypto.timingSafeEqual(stored, provided);
}

exports.requestOtp = async (req, res) => {
  const emailOrUsername = normalizeIdentity(req.body.emailOrUsername);
  const orgCode = String(req.body.organization_code || '').trim();
  if (!emailOrUsername || !orgCode) return res.status(400).json({ message: "Email or username and organization code required" });

  const orgExists = await Organization.exists({ organization_code: orgCode });
  if (!orgExists) return res.status(400).json({ message: "A valid organization_code is required" });

  const user = await User.findOne({
    org_code: orgCode,
    $or: [{ email: emailOrUsername }, { username: emailOrUsername }],
    user_type: 'user',
  });
  // Ticket tracking is email-first: a visitor who opened a ticket (or is
  // just looking theirs up) should receive a code without needing a
  // pre-registered helpdesk password account.
  const recipient = user?.email || (EMAIL_PATTERN.test(emailOrUsername) ? emailOrUsername : null);
  if (!recipient) return res.json({ message: "If the account exists, an OTP has been sent" });

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await OtpToken.findOneAndUpdate(
    { emailOrUsername: recipient, org_code: orgCode },
    { otpHash: hashOtp(otp), attempts: 0, expiresAt, org_code: orgCode },
    { upsert: true, new: true }
  );

  if (process.env.NODE_ENV !== 'production') {
    console.log(JSON.stringify({ level: 'info', event: 'otp_issued_dev', recipient, otp }));
  }

  try {
    await sendOtpEmail(recipient, otp);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'otp_email_failed', message: error.message }));
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ message: "Unable to send verification email" });
    }
  }

  const payload = { message: "If the account exists, an OTP has been sent" };
  if (process.env.NODE_ENV !== 'production') payload.dev_otp = otp;
  return res.json(payload);
};

exports.verifyOtp = async (req, res) => {
  const emailOrUsername = normalizeIdentity(req.body.emailOrUsername);
  const orgCode = String(req.body.organization_code || '').trim();
  const { otp } = req.body;
  if (!emailOrUsername || !orgCode) return res.status(400).json({ message: "Email or username and organization code required" });
  const user = await User.findOne({
    org_code: orgCode,
    $or: [{ email: emailOrUsername }, { username: emailOrUsername }]
  });
  const lookupEmail = user?.email || emailOrUsername;
  const record = await OtpToken.findOne({ emailOrUsername: lookupEmail, org_code: orgCode }).select('+otpHash');

  const providedHash = hashOtp(otp || '');
  if (!record || !hashesMatch(record.otpHash, providedHash) || new Date() > record.expiresAt) {
    if (record) {
      record.attempts += 1;
      if (record.attempts >= 5) await record.deleteOne();
      else await record.save();
    }
    return res.status(400).json({ message: "Invalid or expired OTP" });
  }

  if (user && user.user_type !== "user") {
    return res.status(403).json({ message: "OTP only available for users" });
  }

  const email = user?.email || lookupEmail;
  const token = jwt.sign(
    {
      id: user?._id || email,
      username: user?.username || email,
      email,
      org_code: user?.org_code || orgCode,
      user_type: "otp"
    },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );

  await OtpToken.deleteOne({ emailOrUsername: lookupEmail, org_code: orgCode });

  res.cookie('helpdesk_otp', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000
  });
  res.json({ verified: true });
};
