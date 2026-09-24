// models/OtpToken.js
const mongoose = require("mongoose");

const otpTokenSchema = new mongoose.Schema({
  emailOrUsername: { type: String, required: true, index: true },
  org_code: { type: String, required: true, index: true },
  otpHash: { type: String, required: true, select: false },
  attempts: { type: Number, default: 0, min: 0 },
  expiresAt: { type: Date, required: true, expires: 0 }
});

otpTokenSchema.index({ org_code: 1, emailOrUsername: 1 }, { unique: true, name: 'org_otp_identity_unique' });

module.exports = mongoose.model("OtpToken", otpTokenSchema);
