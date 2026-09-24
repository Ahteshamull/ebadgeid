const express = require('express');
const router = express.Router();
const organizationController = require('../controllers/organizationController');
const { requireAuth, requireAdmin, requirePlatformAdmin, requireOwnOrg } = require('../middleware/requireAuth');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { createRateLimitStore } = require('../utils/distributedRateLimit');

// E2E audit finding N-02: this route is public, unauthenticated, and does
// real work per request -- a Free-plan attempt provisions a real
// organization immediately, and a paid-plan attempt calls Tilopay's real
// createPayment API to mint a hosted payment page. Before this, it only
// had the generic global limiter (300 req/15min, shared with all of
// /api), which is far too loose for a surface this expensive -- same
// reasoning as authLimiter in api.js for /auth/login, just scoped here
// instead since every other dedicated limiter in this codebase
// (digitalContractRoutes.js's contractTokenLimiter, freeTrialRoute.js,
// samlRoutes.js, etc.) is defined locally in its own route file, not
// centralized in api.js.
const selfSignupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: process.env.NODE_ENV !== 'production',
  store: createRateLimitStore('self-signup'),
  message: { message: 'Too many signup attempts from this network, please try again later.' },
});

// Used by public branding/verification pages that only need the org's
// public-facing info — keep this one open, but note it should be scoped
// in the controller to return public fields only (name/logo), not internal
// admin data. See AUDIT_FIXES.md.
router.get('/code/:organization_code', organizationController.getOrganizationByOrgCode);

// Self-service signup -- public and unauthenticated by design (there is
// no account yet). A plan with is_free:true provisions the organization
// and its first admin immediately; any other plan returns a real Tilopay
// hosted-payment-page URL instead (and is refused outright if it has no
// price configured yet -- see selfServiceSignup.js's startSignup). A browser
// redirect is only a customer-navigation event, not payment proof; paid
// provisioning therefore waits for a platform_admin's manual confirmation
// (see the /self-signup/pending routes below).
router.post('/self-signup', selfSignupLimiter, async (req, res) => {
  const { startSignup } = require('../services/selfServiceSignup');
  try {
    const returnBaseUrl = (process.env.PUBLIC_API_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const result = await startSignup({ ...(req.body || {}), returnBaseUrl });
    if (result.free) {
      return res.status(201).json({ status: 'created', organization_code: result.organization_code });
    }
    return res.status(200).json({ status: 'payment_required', paymentUrl: result.paymentUrl });
  } catch (error) {
    if (error.message.includes('TILOPAY_API_USER')) {
      return res.status(503).json({ message: 'Paid self-service signup is not configured on this deployment' });
    }
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

// The product-facing administrator registration form. It maps its explicit
// form fields to the audited shared provisioning service, keeps the new
// password server-side only, and always requires confirmation before bcrypt
// work or database creation begins.
router.post('/administrator-signup', selfSignupLimiter, async (req, res) => {
  const { startAdministratorSignup } = require('../services/selfServiceSignup');
  try {
    const result = await startAdministratorSignup(req.body || {});
    // Do not expose whether an SMTP provider accepted delivery. The account
    // is pending activation either way and the generic resend flow is safe.
    return res.status(201).json({
      status: 'activation_required',
      organization_code: result.organization_code,
      message: 'Your administrator account was created. Check your email to activate it.',
    });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) {
      return res.status(500).json({ message: 'Unable to create the administrator account. Please try again later.' });
    }
    return res.status(status).json({ message: error.message });
  }
});

// Tilopay redirects the customer's browser here (GET, plain query
// params). This endpoint deliberately does not trust that redirect as a
// payment confirmation and never provisions an organization from it --
// see services/selfServiceSignup.js's handleTilopayReturn. Always ends
// in an HTTP redirect to a real frontend page -- this route itself is
// never meant to render anything to the customer directly.
router.get('/self-signup/tilopay-return', async (req, res) => {
  const { handleTilopayReturn } = require('../services/selfServiceSignup');
  const appBase = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  try {
    const result = await handleTilopayReturn({ code: req.query.code, order: req.query.order });
    if (result.ok) {
      return res.redirect(`${appBase}/auth/login?signup=success`);
    }
    return res.redirect(`${appBase}/auth/self_signup?signup=${result.reason || 'failed'}`);
  } catch (error) {
    return res.redirect(`${appBase}/auth/self_signup?signup=error`);
  }
});

// Manual payment-review queue (platform_admin only) -- the other half of
// the fix above. Without this, a paid signup could never complete once
// automatic provisioning from the browser redirect was removed. An admin
// confirms the transaction in Tilopay's own dashboard first, then
// supplies that evidence here; provisioning only happens if the verified
// amount/currency match what was actually charged (see
// services/selfServiceSignup.js's approveSignup).
router.get('/self-signup/pending', requireAuth, requirePlatformAdmin, async (req, res) => {
  const { listPendingSignups } = require('../services/selfServiceSignup');
  const pending = await listPendingSignups({ status: req.query.status || 'awaiting_verification' });
  res.json({ pending, count: pending.length });
});

router.post('/self-signup/pending/:id/approve', requireAuth, requirePlatformAdmin, async (req, res) => {
  const { approveSignup } = require('../services/selfServiceSignup');
  try {
    const { evidence_reference, verified_amount_cents, verified_currency, note } = req.body || {};
    const result = await approveSignup({
      pendingId: req.params.id,
      verifiedBy: req.user.username,
      evidenceReference: evidence_reference,
      verifiedAmountCents: Number(verified_amount_cents),
      verifiedCurrency: verified_currency,
      note,
    });
    res.json({ status: 'approved', organization_code: result.organization_code });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

router.post('/self-signup/pending/:id/reject', requireAuth, requirePlatformAdmin, async (req, res) => {
  const { rejectSignup } = require('../services/selfServiceSignup');
  try {
    await rejectSignup({ pendingId: req.params.id, verifiedBy: req.user.username, note: req.body?.note });
    res.json({ status: 'rejected' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

// SA-03 fix: real backend for Super Admin's Dashboard, which called a
// route that never existed anywhere in this codebase.
router.get('/summary/overview', requireAuth, requirePlatformAdmin, organizationController.getPlatformOverview);

// Plan + consumption. Declared before the '/:id' routes below so the
// literal "plan-usage" segment is never swallowed by the id pattern.
// The consolidated route is platform-admin only; the per-organization one
// is open to any authenticated caller and enforces tenant isolation
// inside the handler (an admin may only read its own organization).
router.get('/plan-usage/all', requireAuth, requirePlatformAdmin, organizationController.getPlanUsageForAllOrganizations);
router.get('/plan-usage', requireAuth, organizationController.getPlanUsage);
router.get('/plan-usage/:organization_code', requireAuth, organizationController.getPlanUsage);

router.post('/', requireAuth, requirePlatformAdmin, organizationController.createOrganization);
router.get('/', requireAuth, requireAdmin, organizationController.getAllOrganizations);
// Declared before /:id so "me" cannot be interpreted as a Mongo id.
router.get('/me', requireAuth, requireAdmin, organizationController.getCurrentOrganization);
router.get('/:id', requireAuth, organizationController.getOrganizationById);
router.put('/:id', requireAuth, requireAdmin, organizationController.updateOrganization);
router.put('/:organization_code/plan', requireAuth, requirePlatformAdmin, organizationController.changeOrganizationPlan);
router.get('/:organization_code/usage', requireAuth, requireOwnOrg('organization_code'), organizationController.getOrganizationUsage);
router.delete('/:id', requireAuth, requirePlatformAdmin, organizationController.deleteOrganization);
module.exports = router;
