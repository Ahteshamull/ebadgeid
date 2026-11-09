// queues/bulkIssuanceWorker.js
//
// Consumes jobs from bulkIssuanceQueue.js and issues each credential by
// calling the existing, already-tested handlers from
// controllers/credentialController.js and controllers/certificateController.js
// — not a reimplementation of their validation, hashing, rendering, and
// email logic. This is a deliberate choice: reusing the real HTTP handlers
// with a synthetic req/res pair means the worker can never drift out of
// sync with what the single-issue flow actually does, at the small cost of
// building minimal fake request objects.
//
// This mirrors the three-step flow the frontend performs for one credential
// at a time: reserve a credential_code, render the certificate image for
// that design (calling the internal certificate microservice), then create
// the credential with the resulting image URL. An earlier version of this
// worker skipped straight to createCredential with the raw design_code
// passed through as if it were already an image URL — createCredential
// requires credential_pic_url to be a real managed-storage URL
// (isAllowedCredentialImage), so every bulk-issuance job failed validation
// immediately. This resolves the design into an actual generated
// certificate image first, same as the existing single-issue flow.
//
// Started only if REDIS_URL is configured (see startBulkIssuanceWorker
// below). Its behaviour IS verified against a real redis-server and real
// BullMQ -- see tests/bulkIssuanceIdempotency.integration.test.js and
// tests/bulkIssuanceQueue.integration.test.js, neither of which mocks the
// queue.
const { Worker } = require('bullmq');
const credentialController = require('../controllers/credentialController');
const certificateController = require('../controllers/certificateController');
const logger = require('../utils/logger');

// Captures whatever a handler passes to res.status(code).json(payload)
// instead of letting it go to a real HTTP response that doesn't exist here.
function buildSyntheticRes() {
  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return res; },
    json(body) { payload = body; return res; },
  };
  return { res, getResult: () => ({ statusCode, payload }) };
}

async function issueOneCredential(jobData) {
  const { achiever_username, design_code, credential_title, organization_code, requested_by, guest_recipient, custom_fields, batchId } = jobData;
  const user = { username: requested_by, organization_code };

  // Makes a retry of this job a no-op instead of a second credential.
  // BullMQ retries a failed job up to three times, and a job can fail
  // AFTER createCredential already wrote the document -- a process restart
  // or a deploy between the write and the ack is enough. Without a key,
  // that retry issues a duplicate certificate, sends a second email, and
  // spends another credential from the monthly plan quota. createCredential
  // returns the credential that already exists when it sees this key again
  // (see controllers/credentialController.js), backed by a unique index so
  // two workers racing cannot both win.
  //
  // Only set when there IS a batch: the LMS webhook path below reuses this
  // same function for a single recipient and has no batch to key on.
  const bulk_issuance_key = batchId ? `${batchId}:${achiever_username}` : undefined;

  const reserveRes = buildSyntheticRes();
  await credentialController.reserveCredentialCode({ body: {}, user }, reserveRes.res);
  const reserved = reserveRes.getResult();
  if (reserved.statusCode >= 400) {
    throw new Error(reserved.payload?.error || `reserveCredentialCode returned ${reserved.statusCode}`);
  }
  const { credential_code } = reserved.payload;

  const certRes = buildSyntheticRes();
  await certificateController.generateCertificate(
    // Boolean flag only here — generateCertificate just needs to know
    // whether to skip its Users existence check (see certificateController.js),
    // it never reads any field off guest_recipient itself.
    { body: { design_code, achiever_username, credential_code, guest_recipient: Boolean(guest_recipient), custom_fields }, user },
    certRes.res
  );
  const certificate = certRes.getResult();
  if (certificate.statusCode >= 400) {
    throw new Error(certificate.payload?.message || `generateCertificate returned ${certificate.statusCode}`);
  }
  const { url: credential_pic_url } = certificate.payload;

  const createRes = buildSyntheticRes();
  await credentialController.createCredential(
    // Full object here — createCredential builds achiever_details and the
    // notification email straight from it when present.
    { body: { credential_pic_url, achiever_username, credential_title, credential_code, guest_recipient: guest_recipient || undefined, custom_fields, bulk_issuance_key }, user },
    createRes.res
  );
  const created = createRes.getResult();
  // 200 with already_issued means a previous attempt at this exact job
  // already produced the credential -- the job is done, not failed.
  if (created.statusCode === 200 && created.payload?.already_issued) {
    logger.info('bulk_issuance_job_already_done', { batchId, achiever_username });
    // The credential exists, so the issued-this-month count already includes
    // it -- the reservation has to go back here too. Returning early without
    // releasing left one credential's worth of quota reserved forever every
    // time a job was retried after its credential had already been written,
    // which is precisely the case retries exist for.
    if (batchId) {
      const { releaseCredentialQuota } = require('../middleware/enforcePlanLimits');
      await releaseCredentialQuota(organization_code, 1).catch((releaseError) => {
        logger.error('bulk_quota_release_failed', { batchId, message: releaseError.message });
      });
    }
    return created.payload;
  }
  if (created.statusCode < 400 && batchId) {
    // The credential now exists, so the issued-this-month count includes it.
    // Releasing the reservation here is what stops it being counted twice --
    // once as reserved and once as issued.
    const { releaseCredentialQuota } = require('../middleware/enforcePlanLimits');
    await releaseCredentialQuota(organization_code, 1).catch((releaseError) => {
      // A stuck reservation is a billing annoyance, not a reason to fail a
      // credential that was already issued successfully.
      logger.error('bulk_quota_release_failed', { batchId, message: releaseError.message });
    });
  }
  if (created.statusCode >= 400) {
    // Throwing marks the job failed (subject to the queue's retry/backoff
    // policy) rather than silently succeeding on a rejected credential
    // (e.g. duplicate code, missing user email).
    throw new Error(created.payload?.error || `createCredential returned ${created.statusCode}`);
  }
  return created.payload;
}

function startBulkIssuanceWorker() {
  if (!process.env.REDIS_URL) {
    logger.info('bulk_issuance_worker_not_started', { reason: 'REDIS_URL not set' });
    return null;
  }

  const worker = new Worker(
    'bulk-credential-issuance',
    (job) => issueOneCredential(job.data),
    { connection: { url: process.env.REDIS_URL }, concurrency: 5 }
  );

  worker.on('failed', async (job, err) => {
    logger.error('bulk_issuance_job_failed', {
      batchId: job?.data?.batchId,
      username: job?.data?.achiever_username,
      attempt: job?.attemptsMade,
      message: err.message,
    });

    // Only once the retries are exhausted: this credential is never going to
    // be written, so the quota reserved for it has to go back. Releasing on
    // an intermediate attempt would hand the quota back while the job is
    // still going to run again, and the organization could end up over its
    // plan. A reservation for a job that dies with the process is not
    // recovered here, but it cannot outlive the month -- the counter resets
    // with the period (see reserveCredentialQuota).
    const attempts = job?.opts?.attempts ?? 1;
    if (job && job.attemptsMade >= attempts && job.data?.batchId) {
      const { releaseCredentialQuota } = require('../middleware/enforcePlanLimits');
      await releaseCredentialQuota(job.data.organization_code, 1).catch((releaseError) => {
        logger.error('bulk_quota_release_failed', {
          batchId: job.data.batchId, message: releaseError.message,
        });
      });
    }
  });

  logger.info('bulk_issuance_worker_started');
  return worker;
}

// Exported for reuse by routes/lmsWebhookRoutes.js — an LMS "course
// completed" webhook needs to run this exact same reserve → generate
// certificate → create credential sequence for one recipient, and should
// never drift from what bulk issuance (or a future caller) does, for the
// same reason this function exists in the first place (see file header).
module.exports = { startBulkIssuanceWorker, issueOneCredential };
