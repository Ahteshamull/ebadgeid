// utils/otpUtils.js
const crypto = require("crypto");

exports.generateOtp = () => {
  return crypto.randomInt(100000, 1000000).toString();
};
exports.generateTemporaryToken = (payload) => {
  return require("jsonwebtoken").sign(payload, process.env.JWT_SECRET, {
    expiresIn: "15m"
  });
};
