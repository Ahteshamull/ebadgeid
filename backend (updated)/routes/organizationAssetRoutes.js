const express = require('express');
const router = express.Router();
const { createAsset, listAssets, deleteAsset } = require('../controllers/organizationAssetController');
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');

router.post('/', requireAuth, requireAdmin, createAsset);
router.get('/', requireAuth, listAssets);
router.delete('/:id', requireAuth, requireAdmin, deleteAsset);

module.exports = router;
