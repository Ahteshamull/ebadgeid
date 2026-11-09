const express = require('express');
const router = express.Router();
const apiKeyController = require('../controllers/apiKeyController');
const { requireAuth, requireAdmin, requireOwnOrg } = require('../middleware/requireAuth');

// API keys are credentials — every route here is admin-only.
// Literal paths must be registered before /:id. Otherwise GET
// /organization/:code is handled as "get key by id = organization" and
// fails with a cast error, which is what made the token list look dead.
router.get('/organization/:organization_code', requireAuth, requireAdmin, requireOwnOrg(), apiKeyController.getOrganizationTokens);
router.patch('/revoke/:token_id', requireAuth, requireAdmin, apiKeyController.revokeToken);
router.post('/:organization_code', requireAuth, requireAdmin, requireOwnOrg(), apiKeyController.createApiKey);
router.get('/', requireAuth, requireAdmin, apiKeyController.getAllApiKeys);
router.get('/:id', requireAuth, requireAdmin, apiKeyController.getApiKeyById);
router.put('/:id', requireAuth, requireAdmin, apiKeyController.updateApiKey);
router.delete('/:id', requireAuth, requireAdmin, apiKeyController.deleteApiKey);
module.exports = router;
