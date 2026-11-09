const express = require('express');
const router = express.Router();
const overviewController = require('../controllers/overviewController');
const { requireAuth, requireOwnOrg } = require('../middleware/requireAuth');

// @route   GET /api/overview/:organization_code
// @desc    Get organization overview
// @access  Protected — was marked "public or add auth if needed" and shipped
//          without it. Overview data includes internal metrics, so it's
//          restricted to members of that org.
router.get('/:organization_code', requireAuth, requireOwnOrg(), overviewController.getOrganizationOverview);
router.get("/employee/:organization_code/:username", requireAuth, requireOwnOrg(), overviewController.getEmployeeOverview);
module.exports = router;
