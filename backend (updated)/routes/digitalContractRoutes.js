// routes/contractRoutes.js
const express = require('express');
const router = express.Router();
const contractController = require('../controllers/digitalContractController');
const safeContractController = require('../controllers/contractSafeController');
const { authenticateToken, authenticateContractAccess, hashAccessToken } = require('../middleware/authMiddleware');
const ContractAccess = require('../models/contractAccess');
const { rateLimit } = require('express-rate-limit');
const { createRateLimitStore } = require('../utils/distributedRateLimit');
const {
  signedPdfUploadMiddleware,
  handleSignedPdfUpload,
  downloadSignedPdf,
} = require('../controllers/uploadController');

const contractTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: process.env.NODE_ENV !== 'production',
  store: createRateLimitStore('contract-token'),
});

router.post('/access-session', contractTokenLimiter, async (req, res, next) => {
  try {
    const accessToken = req.body?.access_token;
    if (typeof accessToken !== 'string' || !/^[a-f0-9]{64}$/i.test(accessToken)) {
      return res.status(400).json({ message: 'Invalid access token format' });
    }
    const tokenHash = hashAccessToken(accessToken);
    const access = await ContractAccess.findOne({
      $or: [{ access_token_hash: tokenHash }, { access_token: accessToken }],
      status: 'active',
    }).select('+access_token +access_token_hash');
    if (!access || new Date() > access.expires_at) {
      return res.status(401).json({ message: 'Invalid or expired access token' });
    }
    if (!access.access_token_hash) {
      access.access_token_hash = tokenHash;
      access.access_token = undefined;
      await access.save();
    }
    res.cookie('contract_access', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/contracts',
      expires: access.expires_at
    });
    return res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post(
  '/:contract_code/signed-upload',
  authenticateContractAccess,
  (req, res, next) => {
    if (req.user?.role === 'admin' || req.contractPermissions?.update) return next();
    return res.status(403).json({ message: 'Contract update permission required' });
  },
  signedPdfUploadMiddleware,
  handleSignedPdfUpload
);

router.get(
  '/:contract_code/private-files/:filename',
  authenticateContractAccess,
  (req, res, next) => {
    if (req.user?.role === 'admin' || req.contractPermissions?.view) return next();
    return res.status(403).json({ message: 'Contract view permission required' });
  },
  downloadSignedPdf
);

// 1. Create Contract (Admin only)
router.post('/create', authenticateToken, contractController.createContract);

// 2. Invite User to Contract (Creator or user with write permission)
router.post('/:contract_code/invite', authenticateToken, contractController.inviteUserToContract);

// 3. Add Discussion (Authenticated user or access token holder)
router.post(
  '/:contract_code/discussion',
  authenticateContractAccess,
  contractController.addDiscussion
);

// 4. Fetch Organization Contracts (Organization members only)
router.get('/organization/:organization_code', authenticateToken, contractController.fetchOrganizationContracts);

// 5. Update Contract (Creator or user with update permission)
router.put('/:contract_code', authenticateContractAccess, safeContractController.updateContract);

// 6. Sign Contract (Authenticated user or access token holder)
router.post(
  '/:contract_code/sign',
  authenticateContractAccess,
  contractController.signContract
);

// 7. Generate Access Token (Creator or Admin only)
router.post('/:contract_code/generate-token', authenticateToken, contractController.generateAccessToken);

// 8. Refresh Access Token (Public route with token validation)
router.post('/refresh-token', contractTokenLimiter, safeContractController.refreshAccessToken);

// 9. Remove User (Admin or user with write permission)
router.delete(
  '/:contract_code/remove/:party_email',
  authenticateToken,
  contractController.removeUser
);

// 10. Accept Invitation (NEW - Authenticated user or access token holder)
router.post(
  '/:contract_code/accept-invitation',
  authenticateContractAccess,
  contractController.acceptInvitation
);
// 11. View Contract (using access code from headers)
router.get(
  '/:contract_code',
  authenticateContractAccess,
  safeContractController.viewContract
);
module.exports = router;
