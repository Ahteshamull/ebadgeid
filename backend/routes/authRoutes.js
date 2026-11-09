const express = require('express');
const router = express.Router();
const { register, activate, resendActivation, forgotPassword, verifyOtp, resetPassword, login, logout, checkUsernameAvailability, me, createPlatformAdmin } = require('../controllers/authController');
const { requireAuth, requireAdmin, requirePlatformAdmin } = require('../middleware/requireAuth');
const { rateLimit } = require('express-rate-limit');
const { createRateLimitStore } = require('../utils/distributedRateLimit');
const { issueCsrfToken } = require('../middleware/csrfProtection');

// Security fix, found during an audit round: this endpoint confirms, by
// design, whether a given username already exists ("is already taken" vs
// "is available") -- useful UX for a signup form, but with no rate limit
// of its own it was only ever covered by api.js's generic globalLimiter
// (300/15min, shared across the whole API), letting it be used to
// enumerate real usernames far faster than a real signup flow ever would.
const usernameCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: process.env.NODE_ENV !== 'production',
  store: createRateLimitStore('check-username'),
});

// Account creation for invitees is atomic in POST /api/users/self-signup.
// Keep this legacy endpoint only for authenticated administrators.
router.post('/register', requireAuth, requireAdmin, register);
// SA-03 fix: real backend for Super Admin's "Create Super Admin" form,
// which previously posted to a route that never existed. Deliberately
// gated to platform_admin only -- see createPlatformAdmin's own comment.
router.post('/superadmin/register', requireAuth, requirePlatformAdmin, createPlatformAdmin);
router.post('/activate', activate);
router.post('/resend-activation', resendActivation);
router.post('/forgot-password', forgotPassword);
// Step 2 of the onboarding app's recovery screen. That UI has always
// POSTed here; this route never existed, so the flow 404'd there.
router.post('/verify-otp', verifyOtp);
router.post('/reset-password', resetPassword);
router.post('/login', login);
router.get('/csrf', (req, res) => res.status(200).json({ csrfToken: issueCsrfToken(res) }));
router.post('/logout', logout);
router.post('/check-username', usernameCheckLimiter, checkUsernameAvailability);

// Get logged-in user
router.get('/me', requireAuth, me);
module.exports = router;
