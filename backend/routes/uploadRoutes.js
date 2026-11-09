const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { uploadMiddleware, handleUpload, fontUploadMiddleware, handleFontUpload, handleGenerateImage } = require('../controllers/uploadController');
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');
const { createRateLimitStore } = require('../utils/distributedRateLimit');

// PDF-to-image conversion is real CPU work — its own tighter limit on top
// of the global one, so a burst of uploads can't be used to degrade the
// rest of the API.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: process.env.NODE_ENV !== 'production',
  store: createRateLimitStore('uploads'),
  message: { message: 'Too many uploads, please try again later.' },
});

router.post('/', requireAuth, requireAdmin, uploadLimiter, uploadMiddleware, handleUpload);
router.post('/font', requireAuth, requireAdmin, uploadLimiter, fontUploadMiddleware, handleFontUpload);
router.post('/generate-image', requireAuth, requireAdmin, uploadLimiter, handleGenerateImage);

module.exports = router;
