const OtpToken = require("../models/OtpToken");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const { generateOtp } = require("../utils/OtpUtils");
const sendOtpEmail = require("../utils/sendEmail");
const crypto = require('crypto');

const hashOtp = otp => crypto.createHmac('sha256', process.env.JWT_SECRET).update(String(otp)).digest('hex');

exports.requestOtp = async (req, res) => {
  const emailOrUsername = String(req.body.emailOrUsername || '').trim().toLowerCase();
  const orgCode = String(req.body.organization_code || '').trim();
  if (!emailOrUsername || !orgCode) return res.status(400).json({ message: "Email or username and organization code required" });

  const user = await User.findOne({
    org_code: orgCode,
    $or: [{ email: emailOrUsername }, { username: emailOrUsername }],
    user_type: 'user',
  });
  // Deliberately return the same response when the identity is unknown.
  if (!user) return res.json({ message: "If the account exists, an OTP has been sent" });

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

  await OtpToken.findOneAndUpdate(
    { emailOrUsername: user.email, org_code: orgCode },
    { otpHash: hashOtp(otp), attempts: 0, expiresAt, org_code: orgCode },
    { upsert: true, new: true }
  );

  // Send OTP mail
  await sendOtpEmail(user.email, otp);

  res.json({ message: "If the account exists, an OTP has been sent" });
};

exports.verifyOtp = async (req, res) => {
  const emailOrUsername = String(req.body.emailOrUsername || '').trim().toLowerCase();
  const orgCode = String(req.body.organization_code || '').trim();
  const { otp } = req.body;
  if (!emailOrUsername || !orgCode) return res.status(400).json({ message: "Email or username and organization code required" });
  const user = await User.findOne({
    org_code: orgCode,
    $or: [{ email: emailOrUsername }, { username: emailOrUsername }]
  });
  const record = user
    ? await OtpToken.findOne({ emailOrUsername: user.email, org_code: orgCode }).select('+otpHash')
    : null;

  const providedHash = hashOtp(otp || '');
  const validHash = record?.otpHash && crypto.timingSafeEqual(Buffer.from(record.otpHash), Buffer.from(providedHash));
  if (!record || !validHash || new Date() > record.expiresAt) {
    if (record) {
      record.attempts += 1;
      if (record.attempts >= 5) await record.deleteOne();
      else await record.save();
    }
    return res.status(400).json({ message: "Invalid or expired OTP" });
  }

  if (!user || user.user_type !== "user") {
    return res.status(403).json({ message: "OTP only available for users" });
  }

  const token = jwt.sign(
    {
      id: user._id,
      username: user.username,
      email: user.email,
      org_code: user.org_code,
      user_type: "otp"
    },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );

  await OtpToken.deleteOne({ emailOrUsername: user.email, org_code: orgCode });

  res.cookie('helpdesk_otp', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000
  });
  res.json({ verified: true });
};
