// routes/samlRoutes.js
//
// Generic SAML 2.0 SSO endpoints -- see services/samlAuth.js for what
// each of these actually does and why. All public/unauthenticated by
// necessity (there's no local session yet at any of these steps), except
// the config endpoint, which only an org's own admin can set.
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { createRateLimitStore } = require('../utils/distributedRateLimit');
const AUTH_COOKIE_NAME = 'ebadge_token';

// Security audit finding (SEC-AUDIT-4): /login and /acs previously relied
// only on the global 300-req/15min-per-IP limiter that covers all of /api --
// every other credential-guessing surface (/api/auth/login) has its own
// tighter budget (see api.js's authLimiter, 20/15min), and each attempt
// against /acs specifically costs real CPU (XML parsing + xmllint schema
// validation) before it can even fail signature verification. Keyed by
// IP + organization_code (not just IP) so a real burst of legitimate SSO
// traffic for one organization can't exhaust the budget for every other
// organization sharing this same route pattern.
const samlAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${req.params.organization_code || ''}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: process.env.NODE_ENV !== 'production',
  store: createRateLimitStore('saml-auth'),
  message: { message: 'Too many SSO attempts for this organization, please try again later.' },
});

router.get('/:organization_code/metadata', async (req, res) => {
  try {
    const { buildMetadataXml } = require('../services/samlAuth');
    res.type('application/xml').send(buildMetadataXml(req.params.organization_code));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/:organization_code/login', samlAuthLimiter, async (req, res) => {
  try {
    const { buildLoginRedirect } = require('../services/samlAuth');
    const context = await buildLoginRedirect(req.params.organization_code);
    res.redirect(context);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

router.post('/:organization_code/acs', samlAuthLimiter, express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { handleAssertion } = require('../services/samlAuth');
    const { token } = await handleAssertion(req.params.organization_code, req.body);
    res.cookie(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000,
    });
    const appBase = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
    res.redirect(`${appBase}/?sso=success`);
  } catch (error) {
    res.status(error.statusCode || 400).json({ message: error.message });
  }
});

// Org admin registers their own IdP's details -- entity ID, SSO URL, and
// signing certificate (public, no secret material) -- to set up the
// trust relationship on this side.
router.put('/config', requireAuth, requireAdmin, async (req, res) => {
  const { idp_entity_id, idp_sso_url, idp_certificate, enabled } = req.body;
  if (!idp_entity_id || !idp_sso_url || !idp_certificate) {
    return res.status(400).json({ message: 'idp_entity_id, idp_sso_url, and idp_certificate are required' });
  }
  const OrganizationSamlConfig = require('../models/organizationSamlConfig');
  const config = await OrganizationSamlConfig.findOneAndUpdate(
    { organization_code: req.user.organization_code },
    { organization_code: req.user.organization_code, idp_entity_id, idp_sso_url, idp_certificate, enabled: enabled !== false },
    { upsert: true, new: true }
  );
  res.json({ organization_code: config.organization_code, idp_entity_id: config.idp_entity_id, enabled: config.enabled });
});

module.exports = router;
