// routes/lmsWebhookRoutes.js
//
// The simpler alternative the user's own notes prefer over LTI 1.3 to
// start: an LMS calls this when a learner completes a course, and a
// credential gets issued automatically, no manual admin action. Reuses
// existing infrastructure end to end rather than inventing new pieces:
//
//   - Auth is the existing X-API-Key mechanism (middleware/requireApiKey.js
//     + routes/apiKeyRoutes.js, already built, already rate-limited per
//     key) -- an org generates a key from the admin panel it already has
//     and hands it to whoever configures the LMS side. No new auth scheme.
//   - Issuance is the exact reserve -> generate certificate -> create
//     credential sequence bulk issuance already uses
//     (queues/bulkIssuanceWorker.js:issueOneCredential), not a
//     reimplementation.
//
// What's real and tested here: the auth gate (a real ApiKey document, a
// real 401/403) and the idempotency guard (a real duplicate-key rejection
// against real MongoDB). What's NOT verified end-to-end in this
// environment: actually completing an issuance, because that chain calls
// out to the certificate microservice over HTTP (CERTIFICATE_SERVICE_URL)
// -- the exact same pre-existing limitation already documented at the top
// of bulkIssuanceWorker.js, not a new gap this webhook introduces.
const express = require('express');
const router = express.Router();
const { requireApiKey } = require('../middleware/requireApiKey');
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');
const { issueOneCredential } = require('../queues/bulkIssuanceWorker');
const LmsWebhookEvent = require('../models/lmsWebhookEvent');
const { validateLmsSyncUrl } = require('../utils/lmsSyncUrl');

router.post('/webhook/course-completed', requireApiKey, async (req, res) => {
  try {
    const { external_event_id, achiever_username, guest_recipient, design_code, credential_title, custom_fields } = req.body;

    if (!external_event_id || typeof external_event_id !== 'string') {
      return res.status(400).json({ error: 'external_event_id is required (used to make retried webhook deliveries safe)' });
    }
    if (!design_code || typeof design_code !== 'string') {
      return res.status(400).json({ error: 'design_code is required' });
    }
    if (!achiever_username && !guest_recipient) {
      return res.status(400).json({ error: 'Either achiever_username (existing account) or guest_recipient (name/email) is required' });
    }

    const organization_code = req.user.organization_code;

    // Idempotency: an LMS retrying a webhook delivery (timeout, a 5xx,
    // at-least-once delivery semantics) must not issue a second
    // credential for the same completion event.
    const existing = await LmsWebhookEvent.findOne({ organization_code, external_event_id });
    if (existing) {
      return res.status(200).json({ status: 'already_processed', credential_code: existing.credential_code });
    }

    const created = await issueOneCredential({
      achiever_username: achiever_username || `${guest_recipient.first_name} ${guest_recipient.last_name}`.trim(),
      design_code,
      credential_title,
      organization_code,
      requested_by: `lms-webhook:${req.user.username || req.user.organization_code}`,
      guest_recipient,
      custom_fields,
    });

    // Recorded only after a successful issuance -- if issueOneCredential
    // throws, nothing is recorded, and a genuine retry can still succeed
    // later. A duplicate-key error here means two near-simultaneous
    // retries both got past the check above (a real race, not a bug) --
    // the credential was issued once either way, so it's swallowed, not
    // surfaced as a failure.
    try {
      await LmsWebhookEvent.create({ organization_code, external_event_id, credential_code: created.credential_code });
    } catch (dedupeError) {
      if (dedupeError.code !== 11000) throw dedupeError;
    }

    res.status(201).json({ status: 'issued', credential_code: created.credential_code });
  } catch (error) {
    res.status(502).json({ error: 'Credential issuance failed', details: error.message });
  }
});

// Get current LMS integration config for the authenticated organization
router.get('/config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const OrganizationLmsConfig = require('../models/organizationLmsConfig');
    const config = await OrganizationLmsConfig.findOne({ organization_code: req.user.organization_code }).lean();
    if (!config) {
      return res.json({ configured: false, enabled: false, sync_api_url: '', last_synced_at: null });
    }
    return res.json({
      configured: true,
      organization_code: config.organization_code,
      sync_api_url: config.sync_api_url,
      enabled: config.enabled,
      last_synced_at: config.last_synced_at,
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch LMS configuration', error: err.message });
  }
});

// The pull half of "bidirectional" -- an admin registers where and how to
// reach their LMS's own API for scheduled reconciliation (see
// services/lmsSync.js and scripts/syncLms.js). The token is encrypted at
// rest immediately, never stored or echoed back in plain text.
router.put('/config', requireAuth, requireAdmin, async (req, res) => {
  const { sync_api_url, sync_api_token, enabled } = req.body;
  if (!sync_api_url || typeof sync_api_url !== 'string') {
    return res.status(400).json({ message: 'sync_api_url is required' });
  }
  if (!sync_api_token || typeof sync_api_token !== 'string') {
    return res.status(400).json({ message: 'sync_api_token is required' });
  }
  let validatedSyncApiUrl;
  try {
    validatedSyncApiUrl = validateLmsSyncUrl(sync_api_url);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ message: error.message });
  }

  const cryptoHelper = require('../utils/cryptoHelper');
  const OrganizationLmsConfig = require('../models/organizationLmsConfig');
  const config = await OrganizationLmsConfig.findOneAndUpdate(
    { organization_code: req.user.organization_code },
    {
      organization_code: req.user.organization_code,
      sync_api_url: validatedSyncApiUrl,
      sync_api_token_encrypted: cryptoHelper.encrypt(sync_api_token),
      enabled: enabled !== false,
    },
    { upsert: true, returnDocument: 'after' }
  );
  res.json({ organization_code: config.organization_code, sync_api_url: config.sync_api_url, enabled: config.enabled, last_synced_at: config.last_synced_at });
});

// Webhook Simulation / Test Ping for LMS Setup Wizard
router.post('/simulate-webhook', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { platform, student_name, student_email, course_name } = req.body;
    return res.json({
      success: true,
      message: `Webhook simulation test successful for ${platform || 'LMS'}`,
      simulated_event: {
        platform: platform || 'Moodle',
        event: 'course_completed',
        course: course_name || 'Introduction to Leadership & Management',
        student: {
          name: student_name || 'Alex Morgan',
          email: student_email || 'alex.morgan@example.com',
        },
        timestamp: new Date().toISOString(),
        status: 'READY_FOR_AUTOMATIC_ISSUANCE',
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Simulation failed', error: error.message });
  }
});

// The "visible log of failed syncs" -- org-scoped, most recent first.
router.get('/sync-log', requireAuth, requireAdmin, async (req, res) => {
  const LmsSyncLog = require('../models/lmsSyncLog');
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const logs = await LmsSyncLog.find({ organization_code: req.user.organization_code }).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({ logs, count: logs.length });
});

module.exports = router;
