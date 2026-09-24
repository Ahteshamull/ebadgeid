const express = require('express');
const router = express.Router();
const {
  createCredential,
  reserveCredentialCode,
  getAllCredentialsByOrganization,
  getCredentialsByUser,
  getCredentialByCode,
  getCredentialAsOpenBadge,
  getCredentialHistory,
  revokeCredential,
  claimCredential,
  getOrganizationAnalytics,
  getPublicPortalByUsername,
  setPortalVisibility
} = require('../controllers/credentialController');
const { requireAuth, requireAdmin, requireOwnOrg, requireAuthOrApiKey } = require('../middleware/requireAuth');
const { checkCredentialLimit } = require('../middleware/enforcePlanLimits');
const { generateCertificate } = require('../controllers/certificateController');
const { rateLimit } = require('express-rate-limit');
const { createRateLimitStore } = require('../utils/distributedRateLimit');

const certificateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: process.env.NODE_ENV !== 'production',
  store: createRateLimitStore('certificates'),
});

// The recipient portal is public and browsable by username (not gated by
// already knowing a specific credential code, unlike /by-code/:code) —
// worth its own, tighter limit so it can't be used to scrape the whole
// platform's claimed-credential holders faster than a real visitor ever
// would.
const portalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: process.env.NODE_ENV !== 'production',
  store: createRateLimitStore('portal'),
});

// Security fix, found during an audit round: by-code/openbadge previously
// relied only on api.js's generic globalLimiter (300/15min, shared across
// every endpoint in the whole API) -- the highest-traffic, least-
// controlled public endpoint in the system had no rate limit of its own,
// unlike certificateLimiter/portalLimiter right here in this same file.
// The credential_code itself is a real 64-bit random value (see
// generateUniqueCredentialCode), so brute-forcing a valid one isn't
// practical even without this -- but this is what actually stops scraping
// the full set of *already-known* codes (shared publicly on résumés,
// LinkedIn, etc.) faster than a real visitor ever would.
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: process.env.NODE_ENV !== 'production',
  store: createRateLimitStore('credential-verify'),
});

// A credential's public verification page is an intentional feature of the
// product (like Credly) — anyone with the code can confirm it's genuine.
router.get('/by-code/:credential_code', verifyLimiter, getCredentialByCode);

// Open Badges 3.0 export of the same public credential — see
// getCredentialAsOpenBadge in credentialController.js for exactly what
// this is (and isn't) a substitute for.
router.get('/by-code/:credential_code/openbadge', verifyLimiter, getCredentialAsOpenBadge);

// Reserve the real credential_code *before* generating the certificate
// image, so the QR baked into that image can point at the right place.
// See AUDIT_FIXES.md, "Diseño de certificados". The plan's monthly
// credential limit is checked here rather than only at /create — no point
// letting an org generate a certificate image (real work, real cost) for a
// credential that's just going to be rejected for quota a step later.
router.post('/reserve-code', requireAuthOrApiKey, checkCredentialLimit, reserveCredentialCode);
router.post('/generate-certificate', requireAuth, requireAdmin, certificateLimiter, generateCertificate);

// Everything that creates, lists in bulk, or changes state requires auth.
// create/revoke also accept an API key — this is the endpoint an external
// LMS integration actually calls (see middleware/requireApiKey.js, which
// previously existed as a model with nothing enforcing it).
router.post('/create', requireAuthOrApiKey, checkCredentialLimit, createCredential);

// Real background job queue for bulk issuance — see queues/bulkIssuanceQueue.js
// for why this replaces the frontend's client-side worker pool. Returns
// 503 explicitly if REDIS_URL isn't configured rather than silently
// accepting a job that will never run.
// Read-only pre-flight for the bulk confirmation screen: "you are about to
// issue N, you have M left". Issues nothing and changes nothing -- it just
// answers with the same allowance calculation POST /bulk-issue will apply,
// so the number the admin confirms against is the number actually
// enforced a moment later, never an optimistic guess made in the browser.
router.get('/bulk-issue/allowance', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { getCredentialAllowance } = require('../middleware/enforcePlanLimits');
    const requested = Number.parseInt(req.query.requested, 10);
    const allowance = await getCredentialAllowance(req.user.organization_code);
    if (!allowance.ok) {
      return res.status(200).json({ ...allowance, can_issue: false, requested: Number.isFinite(requested) ? requested : null });
    }
    const canIssue = allowance.unlimited || !Number.isFinite(requested) || requested <= allowance.remaining;
    return res.status(200).json({
      ...allowance,
      requested: Number.isFinite(requested) ? requested : null,
      can_issue: canIssue,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to check plan allowance' });
  }
});

router.post('/bulk-issue', requireAuth, requireAdmin, async (req, res) => {
  const { enqueueBulkIssuance, isConfigured } = require('../queues/bulkIssuanceQueue');
  if (!isConfigured()) {
    return res.status(503).json({ message: 'Bulk issuance queue is not configured (REDIS_URL is not set on this server).' });
  }
  try {
    const { usernames, recipients: rawRecipients, design_code, credential_title } = req.body;
    // `usernames` (bare strings) is the original shape, kept working as-is
    // for any existing direct caller. `recipients` (objects, each optionally
    // carrying a `guest_recipient`) is the richer shape the frontend sends
    // now that bulk issuance supports recipients with no Users record —
    // same guest_recipient contract as the single-issue endpoint, see
    // credentialController.createCredential.
    let recipients = Array.isArray(rawRecipients) ? rawRecipients : null;
    if (!recipients && Array.isArray(usernames)) {
      recipients = usernames.map((achiever_username) => ({ achiever_username }));
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ message: 'recipients (or usernames) must be a non-empty array' });
    }
    if (recipients.length > 2000) {
      return res.status(400).json({ message: 'A single batch is limited to 2000 recipients' });
    }
    for (const recipient of recipients) {
      if (!recipient || typeof recipient.achiever_username !== 'string' || !recipient.achiever_username.trim()) {
        return res.status(400).json({ message: 'Each recipient needs a non-empty achiever_username' });
      }
    }

    // Plan quota, checked BEFORE anything is enqueued.
    //
    // Bulk issuance bypasses checkCredentialLimit entirely: that middleware
    // guards the single-issue route, while the worker calls the controllers
    // directly (queues/bulkIssuanceWorker.js). Without this, an
    // organization on a 25-a-month plan could enqueue 2000 and every one
    // would be written -- the quota simply would not apply to the path that
    // issues the most credentials. Refusing here, with the real numbers,
    // also means the admin is told up front instead of discovering a
    // half-finished batch later.
    // RESERVES the quota rather than merely checking it -- two admins
    // submitting 15 each against 15 remaining must not both succeed. See
    // reserveCredentialQuota for why the check has to be the reservation.
    const { reserveCredentialQuota, releaseCredentialQuota } = require('../middleware/enforcePlanLimits');
    const reservation = await reserveCredentialQuota(req.user.organization_code, recipients.length);
    if (!reservation.ok) {
      if (reservation.reason === 'quota_exceeded') {
        return res.status(402).json({
          message: `This batch needs ${recipients.length} credentials but only ${reservation.remaining} remain on the ${reservation.plan_name} plan this month (${reservation.used}/${reservation.limit} used). Reduce the batch or upgrade the plan.`,
          plan: reservation.plan_name,
          limit: reservation.limit,
          used: reservation.used,
          remaining: reservation.remaining,
          in_flight: reservation.in_flight,
          requested: recipients.length,
        });
      }
      return res.status(402).json({
        message: reservation.reason === 'plan_not_found'
          ? `This organization is on the "${reservation.plan_name}" plan, but no plan with that name is configured, so no limit can be applied. Ask a platform administrator to configure it.`
          : 'Unable to determine this organization\'s plan.',
      });
    }

    // Opt-in per organization (organization_schema.js:require_bulk_approval).
    // When set, this request is held for an admin to explicitly approve
    // (see the /bulk-issue/pending routes below) instead of enqueueing
    // immediately -- nothing is issued until that happens.
    const Organization = require('../models/organization_schema');
    const org = await Organization.findOne({ organization_code: req.user.organization_code }).lean();
    if (org?.require_bulk_approval) {
      // Nothing is being issued yet, so the reservation is handed back --
      // it will be taken again, against the allowance of the day, when
      // someone actually approves this.
      await releaseCredentialQuota(req.user.organization_code, recipients.length);
      const BulkIssuanceApproval = require('../models/bulkIssuanceApproval');
      const pending = await BulkIssuanceApproval.create({
        organization_code: req.user.organization_code,
        recipients,
        design_code,
        credential_title,
        requested_by: req.user.username,
        status: 'pending',
      });
      return res.status(202).json({ status: 'pending_approval', pending_approval_id: pending._id, total: recipients.length });
    }

    let result;
    try {
      result = await enqueueBulkIssuance({
        recipients,
        design_code,
        credential_title,
        organization_code: req.user.organization_code,
        requested_by: req.user.username,
      });
    } catch (enqueueError) {
      // The quota was reserved a moment ago for a batch that will now never
      // run; leaving it reserved would silently cost the organization its
      // allowance for nothing.
      await releaseCredentialQuota(req.user.organization_code, recipients.length);
      throw enqueueError;
    }
    res.status(202).json(result);
  } catch (error) {
    res.status(500).json({ message: 'Failed to enqueue bulk issuance', details: error.message });
  }
});

// List pending bulk-issuance requests awaiting approval for the caller's
// own organization -- who requested what, and how many recipients.
router.get('/bulk-issue/pending', requireAuth, requireAdmin, async (req, res) => {
  const BulkIssuanceApproval = require('../models/bulkIssuanceApproval');
  const pending = await BulkIssuanceApproval.find({
    organization_code: req.user.organization_code,
    status: 'pending',
  }).select('-recipients').sort({ createdAt: -1 }).lean();
  res.json({ pending, count: pending.length });
});

// Approving is what actually enqueues the batch -- a pending request by
// itself never issues anything. Org-scoped via the query itself, same
// pattern as every other cross-tenant-sensitive lookup in this file.
router.post('/bulk-issue/:pendingId/approve', requireAuth, requireAdmin, async (req, res) => {
  const BulkIssuanceApproval = require('../models/bulkIssuanceApproval');
  const { enqueueBulkIssuance, isConfigured } = require('../queues/bulkIssuanceQueue');
  const pending = await BulkIssuanceApproval.findOne({
    _id: req.params.pendingId,
    organization_code: req.user.organization_code,
    status: 'pending',
  });
  if (!pending) return res.status(404).json({ message: 'Pending bulk issuance request not found' });
  if (!isConfigured()) {
    return res.status(503).json({ message: 'Bulk issuance queue is not configured (REDIS_URL is not set on this server).' });
  }
  // Re-check the plan quota HERE, not only when the batch was requested.
  // Approval can come hours or days later, by which time the month's
  // allowance may have been spent on other issuance -- approving on the
  // strength of a stale check would put the organization over its plan.
  // This is the moment credentials actually get enqueued, so this is the
  // moment the limit has to hold.
  const { reserveCredentialQuota, releaseCredentialQuota } = require('../middleware/enforcePlanLimits');
  const reservation = await reserveCredentialQuota(pending.organization_code, pending.recipients.length);
  if (!reservation.ok) {
    if (reservation.reason === 'quota_exceeded') {
      // Left pending rather than rejected: nothing is wrong with the request,
      // there is simply no room this month. It stays approvable once the
      // quota resets or the plan is upgraded.
      return res.status(402).json({
        message: `This batch needs ${pending.recipients.length} credentials but only ${reservation.remaining} remain on the ${reservation.plan_name} plan this month (${reservation.used}/${reservation.limit} used). It stays pending until the quota resets or the plan is upgraded.`,
        plan: reservation.plan_name,
        limit: reservation.limit,
        used: reservation.used,
        remaining: reservation.remaining,
        requested: pending.recipients.length,
      });
    }
    return res.status(402).json({
      message: reservation.reason === 'plan_not_found'
        ? `This organization is on the "${reservation.plan_name}" plan, but no plan with that name is configured, so no limit can be applied. Ask a platform administrator to configure it.`
        : 'Unable to determine this organization\'s plan.',
    });
  }

  let result;
  try {
    result = await enqueueBulkIssuance({
      recipients: pending.recipients,
      design_code: pending.design_code,
      credential_title: pending.credential_title,
      organization_code: pending.organization_code,
      requested_by: pending.requested_by,
    });
  } catch (enqueueError) {
    await releaseCredentialQuota(pending.organization_code, pending.recipients.length);
    throw enqueueError;
  }
  pending.status = 'approved';
  pending.reviewed_by = req.user.username;
  pending.reviewed_at = new Date();
  pending.batch_id = result.batchId;
  await pending.save();
  res.json({ status: 'approved', batchId: result.batchId, total: result.total, approved_by: req.user.username });
});

// Rejecting leaves the request as a permanent record of who asked for
// what and why it didn't go out -- never enqueues anything.
router.post('/bulk-issue/:pendingId/reject', requireAuth, requireAdmin, async (req, res) => {
  const BulkIssuanceApproval = require('../models/bulkIssuanceApproval');
  const pending = await BulkIssuanceApproval.findOne({
    _id: req.params.pendingId,
    organization_code: req.user.organization_code,
    status: 'pending',
  });
  if (!pending) return res.status(404).json({ message: 'Pending bulk issuance request not found' });
  pending.status = 'rejected';
  pending.reviewed_by = req.user.username;
  pending.reviewed_at = new Date();
  pending.rejection_reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : undefined;
  await pending.save();
  res.json({ status: 'rejected', rejected_by: req.user.username });
});

router.get('/bulk-issue/:batchId', requireAuth, requireAdmin, async (req, res) => {
  const { getBatchStatus, isConfigured } = require('../queues/bulkIssuanceQueue');
  if (!isConfigured()) {
    return res.status(503).json({ message: 'Bulk issuance queue is not configured (REDIS_URL is not set on this server).' });
  }
  // Scoped to the caller's own organization — see getBatchStatus for why:
  // without this, an admin who knew or guessed another org's batchId could
  // read that org's bulk-issuance progress.
  const status = await getBatchStatus(req.params.batchId, req.user.organization_code);
  if (!status) return res.status(404).json({ message: 'Batch not found' });
  res.json(status);
});
router.get('/by-organization/:organization_code', requireAuth, requireOwnOrg('organization_code'), getAllCredentialsByOrganization);
router.get('/by-user/:username', requireAuth, getCredentialsByUser);
// Alias: the frontend (src/app/creds/page.js) calls the plural form.
router.get('/by-users/:username', requireAuth, getCredentialsByUser);
router.put('/revoke/:credential_code', requireAuth, requireAdmin, revokeCredential);
router.get('/:credential_code/history', requireAuth, requireAdmin, getCredentialHistory);
router.put('/claim/:credential_code', requireAuth, claimCredential);

// Explicit opt-in/opt-out for the public portal — only the credential's
// own claimed recipient (see setPortalVisibility's ownership check).
router.put('/portal-visibility/:credential_code', requireAuth, setPortalVisibility);

// Issuer-facing analytics — org-scoped the same way every other
// organization-level read already is.
router.get('/analytics/organization/:organization_code', requireAuth, requireOwnOrg('organization_code'), getOrganizationAnalytics);

// Public recipient portal — see getPublicPortalByUsername for why this is
// scoped to Claimed credentials only, and portalLimiter above for why it
// has its own (tighter) rate limit.
router.get('/portal/:username', portalLimiter, getPublicPortalByUsername);

module.exports = router;
