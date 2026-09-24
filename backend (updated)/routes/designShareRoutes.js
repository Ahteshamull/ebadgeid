// routes/designShareRoutes.js
const express = require('express');
const router = express.Router();
const {
    shareDesign, listSharedWithMe, listSharedByMe, revokeShare, importSharedDesign,
} = require('../controllers/designShareController');
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');

router.post('/', requireAuth, requireAdmin, shareDesign);
router.get('/received', requireAuth, requireAdmin, listSharedWithMe);
router.get('/sent', requireAuth, requireAdmin, listSharedByMe);
router.delete('/:share_id', requireAuth, requireAdmin, revokeShare);
router.post('/:share_id/import', requireAuth, requireAdmin, importSharedDesign);

module.exports = router;
