// routes/invitationRoutes.js
const express = require('express');
const router = express.Router();
const invitationController = require('../controllers/invitationController');
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');
const { checkUserLimit } = require('../middleware/enforcePlanLimits');
const Invitation = require('../models/invitation_schema');
const { rateLimit } = require('express-rate-limit');
const { uploadMiddleware, handleProfileImageUpload } = require('../controllers/uploadController');
const { createRateLimitStore } = require('../utils/distributedRateLimit');

const invitationUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: process.env.NODE_ENV !== 'production',
  store: createRateLimitStore('invitation-upload'),
});

// Generate invitation — only an org admin can invite people. checkUserLimit
// here is a fail-fast convenience (refuses to generate a new invitation
// once the org is already at its seat limit) -- it is NOT the real
// enforcement, since generating an invite doesn't create a user yet and
// several invites can be generated in parallel while still under the
// limit. The authoritative check is in userController.js's
// self_signup_user, at the moment a user is actually created (see the
// header comment there for why the same enforcement is needed on both).
router.post('/generate', requireAuth, requireAdmin, checkUserLimit, invitationController.generateInvitation);

// The invitee doesn't have an account yet, so verifying/checking their own
// invitation stays public by design.
router.post('/verify/:encrypted_verification_code', invitationController.verifyInvitation);
router.post('/profile-upload/:invitation_code', invitationUploadLimiter, async (req, res, next) => {
  try {
    const invitation = await Invitation.exists({
      invitation_code: req.params.invitation_code,
      status: 'Active',
      expires_at: { $gt: new Date() },
    });
    if (!invitation) return res.status(403).json({ message: 'Active invitation required' });
    return next();
  } catch (error) {
    return next(error);
  }
}, uploadMiddleware, handleProfileImageUpload);
router.get('/status/:invitation_code', invitationController.getInvitationStatus);

module.exports = router;
