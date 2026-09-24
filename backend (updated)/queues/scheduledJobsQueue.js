// queues/scheduledJobsQueue.js
//
// H-02 follow-up: the daily expiry-notification and blockchain-anchor
// jobs were first wired up with node-cron -- a real fix for "nothing ever
// triggers these," but only a per-process in-memory timer, with no
// protection against two instances of the cron service (a rolling
// deploy, a manual scale-up, a brief overlap during a restart) both
// firing the same scheduled occurrence. This project already has a real
// Redis-backed job queue (see queues/bulkIssuanceQueue.js) -- reusing
// that same infrastructure via BullMQ's job scheduler is the requested
// fix: Redis, not process memory, is the source of truth for "has this
// occurrence already been claimed," so running N replicas of the cron
// service is safe by construction, not by convention.
const { Queue } = require('bullmq');

let queue = null;

function isConfigured() {
  return Boolean(process.env.REDIS_URL);
}

function getQueue() {
  if (!isConfigured()) return null;
  if (!queue) {
    queue = new Queue('scheduled-jobs', {
      connection: { url: process.env.REDIS_URL },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { age: 30 * 24 * 60 * 60 }, // keep a month of history to inspect
        removeOnFail: { age: 90 * 24 * 60 * 60 },
      },
    });
  }
  return queue;
}

// The one place the schedule is configured -- see PRODUCTION_RUNBOOK.md's
// "Cron / trabajos programados" section for how to change these without
// touching any other file. Standard 5-field cron syntax, evaluated in UTC.
const SCHEDULE = {
  // Comfortably after 'anchor-daily-batch' below has anchored yesterday's
  // batch, and outside real-time issuance traffic for this product's
  // documented primary market.
  'notify-expiring-credentials': '0 6 * * *',
  // Matches anchorDailyBatch.js's own header comment: "run this once a
  // day after midnight and every credential issued the previous day is
  // already final."
  'anchor-daily-batch': '30 0 * * *',
  // E2E audit H-22 follow-up: permanently purges any organization whose
  // soft-delete retention window (PURGE_RETENTION_DAYS in
  // services/organizationPurgeService.js) has expired. Runs once a day,
  // outside the other two jobs' windows.
  'purge-expired-organizations': '0 3 * * *',
  // Production checklist: encrypted MongoDB backups (services/backupService.js).
  // Runs before anything else touches the database for the day, so the
  // backup reflects a quiet moment. Restore-testing is deliberately NOT
  // scheduled here -- it's a manual, periodic exercise (see
  // scripts/restoreBackupTest.js and PRODUCTION_RUNBOOK.md).
  'backup-database': '0 1 * * *',
  // Real recovery fix: a paid-signup approval can crash mid-transaction
  // (container restart, an OOM kill) after being claimed as 'provisioning'
  // but before either completing or reaching approveSignup's own
  // try/catch revert -- see services/selfServiceSignup.js's
  // recoverStuckProvisioningSignups() for the exact window this covers.
  // Every 15 minutes, not daily like the jobs above: a stuck paid signup
  // blocks a real customer's account from ever completing, so it should
  // never wait until the next day to be swept back into the review queue.
  'recover-stuck-signups': '*/15 * * * *',
};

// Idempotent by construction: BullMQ's upsertJobScheduler creates the
// scheduler on first call and updates it in place on every subsequent
// one (a redeploy, a crash-restart, a second replica starting up) --
// never a second, duplicate schedule for the same job id. Safe to call
// unconditionally every time this service starts.
async function registerSchedules() {
  const q = getQueue();
  if (!q) throw new Error('REDIS_URL is required to register scheduled jobs');
  for (const [jobName, pattern] of Object.entries(SCHEDULE)) {
    await q.upsertJobScheduler(jobName, { pattern }, { name: jobName });
  }
  return SCHEDULE;
}

module.exports = { getQueue, isConfigured, registerSchedules, SCHEDULE };
