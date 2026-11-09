// queues/bulkIssuanceQueue.js
//
// Real background job queue for bulk credential issuance, replacing the
// frontend's client-side worker pool (Promise.all over N concurrent
// browser-side calls, see AUDIT_FIXES.md) — that approach loses all
// progress if the tab closes mid-batch, has no retry, and no way to
// resume. This is real infrastructure (Redis-backed via BullMQ), and it IS
// verified against a real redis-server — tests/bulkIssuanceQueue.integration
// .test.js and tests/bulkIssuancePlanQuota.integration.test.js both run it
// against redis-memory-server, not a mock.
// Degrades explicitly rather than silently: if REDIS_URL isn't set, the
// enqueue endpoint returns a clear 503 telling the caller bulk issuance
// isn't configured, instead of pretending to accept a job that will never
// run.
const { Queue } = require('bullmq');
const crypto = require('crypto');

let queue = null;

function isConfigured() {
  return Boolean(process.env.REDIS_URL);
}

function getQueue() {
  if (!isConfigured()) return null;
  if (!queue) {
    queue = new Queue('bulk-credential-issuance', {
      connection: { url: process.env.REDIS_URL },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 24 * 60 * 60 }, // keep finished jobs 24h for status polling
        removeOnFail: { age: 7 * 24 * 60 * 60 }, // keep failed jobs a week for debugging
      },
    });
  }
  return queue;
}

// One job per credential, not one job for the whole batch — a single
// failed username (e.g. user has no email on file) shouldn't block or
// retry the entire batch, and per-job progress is what lets the frontend
// show real "N of M done" progress instead of an all-or-nothing spinner.
// `recipients` is an array of { achiever_username, guest_recipient? } —
// guest_recipient carries the name/email of someone with no Users record
// in this organization (see credentialController.createCredential); each
// job forwards it through untouched so the worker's per-credential flow can
// pass it to generateCertificate/createCredential exactly like the single-
// issue path does.
async function enqueueBulkIssuance({ recipients, design_code, credential_title, organization_code, requested_by }) {
  const q = getQueue();
  if (!q) {
    throw new Error('Bulk issuance queue is not configured (REDIS_URL is not set)');
  }
  const batchId = `batch-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const jobs = recipients.map((recipient) => ({
    name: 'issue-credential',
    data: {
      batchId,
      achiever_username: recipient.achiever_username,
      guest_recipient: recipient.guest_recipient || null,
      custom_fields: recipient.custom_fields || null,
      // Resolved to a real, certificate-service-generated image URL by the
      // worker (reserve code -> generate certificate -> create credential),
      // same as the existing single-issue flow — see bulkIssuanceWorker.js.
      design_code,
      credential_title,
      organization_code,
      requested_by,
    },
  }));
  await q.addBulk(jobs);
  return { batchId, total: jobs.length };
}

// `organizationCode` is required and enforced here, not left to the caller
// to remember: without it, any admin who knew or guessed another org's
// batchId (format batch-<timestamp>-<8 hex>) could read that org's bulk-
// issuance progress. A batch with zero matching jobs — because the id is
// wrong, or because it belongs to a different organization — returns null
// either way, so a cross-org lookup is indistinguishable from a genuinely
// unknown batchId (both 404 at the route level) rather than leaking which
// case it was.
async function getBatchStatus(batchId, organizationCode) {
  const q = getQueue();
  if (!q) return null;
  const jobs = await q.getJobs(['completed', 'failed', 'active', 'waiting', 'delayed']);
  const batchJobs = jobs.filter((j) => j.data?.batchId === batchId && j.data?.organization_code === organizationCode);
  if (batchJobs.length === 0) return null;
  return {
    batchId,
    total: batchJobs.length,
    completed: batchJobs.filter((j) => j.finishedOn && !j.failedReason).length,
    failed: batchJobs.filter((j) => j.failedReason).length,
    pending: batchJobs.filter((j) => !j.finishedOn).length,
  };
}

module.exports = { getQueue, isConfigured, enqueueBulkIssuance, getBatchStatus };
