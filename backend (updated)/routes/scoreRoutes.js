const express = require('express');
const router = express.Router();
const scoreController = require('../controllers/scoreController');
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');

router.post('/', requireAuth, requireAdmin, scoreController.createScore);
router.get('/', requireAuth, requireAdmin, scoreController.getAllScores);
router.get('/:id', requireAuth, scoreController.getScoreById);
router.put('/:id', requireAuth, requireAdmin, scoreController.updateScore);
router.delete('/:id', requireAuth, requireAdmin, scoreController.deleteScore);
module.exports = router;
