// services/lmsSync.js
//
// The pull half of "bidirectional" LMS integration -- reconciles
// completions the LMS's webhook might never have delivered (a genuine
// gap: routes/lmsWebhookRoutes.js only ever hears about a completion if
// the LMS's own webhook attempt actually reached us). No specific LMS
// platform is integrated against here (Moodle, Canvas, etc. each have
// their own API) -- this defines the one generic contract this system
// expects (GET <sync_api_url>/completions?since=<ISO8601>, Bearer auth,
// { completions: [{ external_event_id, achiever_username, guest_recipient?,
// design_code, credential_title? }] }), which an LMS-specific adapter
// would translate to/from. Reuses the exact same idempotency table
// (LmsWebhookEvents) and issuance path (issueOneCredential) the webhook
// already uses, so a completion synced this way and one pushed via
// webhook can never double-issue, whichever arrives first.
const OrganizationLmsConfig = require('../models/organizationLmsConfig');
const LmsWebhookEvent = require('../models/lmsWebhookEvent');
const LmsSyncLog = require('../models/lmsSyncLog');
const cryptoHelper = require('../utils/cryptoHelper');
const { issueOneCredential } = require('../queues/bulkIssuanceWorker');
const logger = require('../utils/logger');
const { validateLmsSyncUrl, assertResolvesToPublicAddress } = require('../utils/lmsSyncUrl');

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Injectable so tests (and, eventually, a real per-LMS adapter) don't
// have to make a real HTTP call against a real LMS that doesn't exist in
// this environment -- the retry/logging/idempotency logic below is what's
// actually being verified, not any specific LMS's HTTP quirks.
async function defaultFetchCompletions(syncApiUrl, token, sinceIso) {
  // Revalidate at the point of use. Configurations can predate the
  // allowlist and database contents must never be trusted as network input.
  const safeBaseUrl = validateLmsSyncUrl(syncApiUrl);
  const url = `${safeBaseUrl}/completions?since=${encodeURIComponent(sinceIso)}`;

  // Security fix, found during an audit round -- two gaps in the SSRF
  // defense above, both closed here:
  //   1. DNS rebinding: the hostname passed validateLmsSyncUrl, but a DNS
  //      answer can point anywhere (including at the exact moment of this
  //      request) and was never itself checked. Resolved and re-checked
  //      immediately before use, not once at config-save time.
  //   2. Redirects: fetch() follows 3xx responses by default, which would
  //      let an approved-but-compromised (or simply misbehaving) host
  //      redirect this request anywhere -- an internal service, a cloud
  //      metadata endpoint -- bypassing every check above. redirect:
  //      'manual' stops fetch from ever following one automatically; a
  //      3xx here is treated as a hard failure instead, the same
  //      allow_redirects=False stance utils/main.py already takes for the
  //      same class of "trusted URL, external target" request.
  await assertResolvesToPublicAddress(new URL(url).hostname);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    throw new Error('LMS sync endpoint attempted to redirect the request, which is not followed');
  }
  if (!response.ok) {
    throw new Error(`LMS sync endpoint returned ${response.status}`);
  }
  const body = await response.json();
  if (!Array.isArray(body?.completions)) {
    throw new Error('LMS sync endpoint response missing a completions array');
  }
  return body.completions;
}

async function fetchWithRetry(fetchFn, syncApiUrl, token, sinceIso) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const completions = await fetchFn(syncApiUrl, token, sinceIso);
      return { completions, attempts: attempt };
    } catch (error) {
      lastError = error;
      logger.error('lms_sync_fetch_attempt_failed', { attempt, message: error.message });
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw Object.assign(lastError, { attempts: MAX_ATTEMPTS });
}

// One organization's sync run, start to finish: fetch (with retry) ->
// issue anything new (skipping anything already processed, whether via a
// prior pull or the push webhook) -> always write a real, queryable log
// row, success or failure, so GET /api/lms/sync-log has something to show
// either way.
async function syncOrganization(config, { fetchFn = defaultFetchCompletions } = {}) {
  const startedAt = new Date();
  const sinceIso = (config.last_synced_at || new Date(0)).toISOString();
  const token = cryptoHelper.decrypt(config.sync_api_token_encrypted);

  const log = { organization_code: config.organization_code, started_at: startedAt, records_found: 0, records_issued: 0, records_already_processed: 0, records_failed: 0, attempts: 1 };

  let completions;
  try {
    const result = await fetchWithRetry(fetchFn, config.sync_api_url, token, sinceIso);
    completions = result.completions;
    log.attempts = result.attempts;
    log.records_found = completions.length;
  } catch (error) {
    log.status = 'failed';
    log.finished_at = new Date();
    log.error_message = error.message;
    log.attempts = error.attempts || MAX_ATTEMPTS;
    await LmsSyncLog.create(log);
    return log;
  }

  for (const item of completions) {
    if (!item?.external_event_id) {
      log.records_failed += 1;
      continue;
    }
    const existing = await LmsWebhookEvent.findOne({ organization_code: config.organization_code, external_event_id: item.external_event_id });
    if (existing) {
      log.records_already_processed += 1;
      continue;
    }
    try {
      const created = await issueOneCredential({
        achiever_username: item.achiever_username || (item.guest_recipient && `${item.guest_recipient.first_name} ${item.guest_recipient.last_name}`.trim()),
        design_code: item.design_code,
        credential_title: item.credential_title,
        organization_code: config.organization_code,
        requested_by: `lms-sync:${config.organization_code}`,
        guest_recipient: item.guest_recipient,
        custom_fields: item.custom_fields,
      });
      try {
        await LmsWebhookEvent.create({ organization_code: config.organization_code, external_event_id: item.external_event_id, credential_code: created.credential_code });
      } catch (dedupeError) {
        if (dedupeError.code !== 11000) throw dedupeError;
      }
      log.records_issued += 1;
    } catch (error) {
      log.records_failed += 1;
      logger.error('lms_sync_issuance_failed', { organization_code: config.organization_code, external_event_id: item.external_event_id, message: error.message });
    }
  }

  log.status = log.records_failed > 0 && log.records_issued === 0 && completions.length > 0 ? 'failed' : 'success';
  log.finished_at = new Date();
  await LmsSyncLog.create(log);
  await OrganizationLmsConfig.updateOne({ _id: config._id }, { $set: { last_synced_at: startedAt } });
  return log;
}

async function syncAllOrganizations(options = {}) {
  const configs = await OrganizationLmsConfig.find({ enabled: true }).select('+sync_api_token_encrypted');
  const results = [];
  for (const config of configs) {
    results.push(await syncOrganization(config, options));
  }
  return results;
}

module.exports = { syncOrganization, syncAllOrganizations, defaultFetchCompletions, MAX_ATTEMPTS };
