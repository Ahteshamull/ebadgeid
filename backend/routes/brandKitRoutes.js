// routes/brandKitRoutes.js
const express = require('express');
const router = express.Router();
const { getBrandKit, updateBrandKit } = require('../controllers/brandKitController');
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');

router.get('/', requireAuth, requireAdmin, getBrandKit);
router.put('/', requireAuth, requireAdmin, updateBrandKit);

module.exports = router;
