const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  password: {
    type: String,
    required: true,
    select: false,
  },
  user_role: {
    type: String,
    // LOW-01 fix: 'teacher' added to match a role the frontend already
    // promises (sidebar.js, and 5 layout.js files' requiredRole checks --
    // see middleware/requireAuth.js's requireAdminOrTeacher for the exact
    // matching backend gate) but that no account could ever actually hold
    // before this, since this enum rejected it outright. No signup/
    // registration path assigns this role automatically -- same as
    // platform_admin, it's only ever set deliberately (directly, by
    // whoever operates the database), never through a public endpoint.
    // 'super_admin' is not a role this codebase issues -- 'platform_admin'
    // is its own top tier. It is listed here because the REAL production
    // database already contains an account holding it (verified live:
    // 1 of 10 accounts). Leaving it out means Mongoose rejects that
    // document on any full-document validation, which is exactly how the
    // deployed system's password reset broke: .save() re-validated the
    // whole user and threw on a field the operation never touched, so
    // that account could not reset its password at all. Accepting the
    // value here is what makes this codebase safe to deploy over that
    // database; treat it as legacy-compatibility, not as a role to grant.
    enum: ['platform_admin', 'admin', 'teacher', 'user', 'super_admin'],
    default: 'user',
  },
  activation_token_hash: { type: String, select: false, index: true },
  activation_expires_at: { type: Date, select: false },
  // New administrator self-registration stores the bcrypt password before
  // the email link is used. Legacy platform-created administrators still
  // choose a password during activation. This explicit state avoids ever
  // guessing from a password hash or weakening either flow.
  activation_password_preselected: { type: Boolean, default: false, select: false },
  // Self-service "forgot password" for an already-activated account --
  // same shape as activation_token_hash/activation_expires_at above
  // (SHA-256 hash of a random token, never the raw token itself), see
  // authController.js's forgotPassword/resetPassword.
  reset_token_hash: { type: String, select: false, index: true },
  reset_token_expires_at: { type: Date, select: false },
  // OTP variant of the same single reset grant above -- NOT a second,
  // parallel reset mechanism. forgotPassword issues one reset record and
  // two equally-valid ways to prove ownership of the mailbox it was sent
  // to: the emailed link (reset_token_hash, used by the main app) and a
  // 6-digit code (this, used by the onboarding app, whose UI asks the
  // user to type the code rather than leave the page). verifyOtp
  // exchanges a correct code for that same reset token, so the actual
  // password write still goes through exactly one code path
  // (resetPassword), already covered by tests/passwordReset.integration.test.js.
  //
  // Only the SHA-256 hash is stored, never the code itself -- same
  // treatment as the token above, so a database dump never yields a
  // usable credential. Shorter expiry than the link (15 min vs 1 hour):
  // a 6-digit code is 1e6 possibilities, so it leans on a narrow window
  // plus the attempt counter below, while a 32-byte token does not.
  reset_otp_hash: { type: String, select: false },
  reset_otp_expires_at: { type: Date, select: false },
  // Hard cap on wrong guesses against a single issued code (see
  // OTP_MAX_ATTEMPTS in authController.js). Without this, the global
  // IP+username rate limit alone would still allow far too many tries at
  // a 6-digit space across a long window.
  reset_otp_attempts: { type: Number, select: false, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Auth', userSchema);
