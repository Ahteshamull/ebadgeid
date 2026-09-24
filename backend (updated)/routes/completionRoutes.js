const express = require('express');
const router = express.Router();
const completionController = require('../controllers/completionController');
const { requireAuth, requireAdmin, requireOwnOrg } = require('../middleware/requireAuth');

router.post('/', requireAuth, completionController.createCompletion);
router.get('/', requireAuth, requireAdmin, completionController.getAllCompletions);
router.get('/org/:organization_code', requireAuth, requireOwnOrg('organization_code'), completionController.getCompletionsByOrg);
router.get('/user/:username', requireAuth, completionController.getCompletionsByUser);
router.patch('/:id/approve', requireAuth, requireAdmin, completionController.approveCompletion);
router.patch('/:id/reject', requireAuth, requireAdmin, completionController.rejectCompletion);
module.exports = router;
