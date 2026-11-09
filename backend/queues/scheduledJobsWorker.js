// queues/scheduledJobsWorker.js
//
// Processes the two scheduled jobs registered by scheduledJobsQueue.js,
// calling the exact same run() entrypoints scripts/notifyExpiringCredentials.js
// and scripts/anchorDailyBatch.js already exposed for manual/CLI use --
// there is no second, divergent implementation of what "run the notifier"
// or "run the anchor batch" means. concurrency: 1 because both jobs touch
// the whole organization/credential set for the day; there is nothing to
// gain from running them in parallel with themselves, and every retry
// (see defaultJobOptions in scheduledJobsQueue.js) should complete before
// a new occurrence's job is picked up.
const { Worker } = require('bullmq');
const logger = require('../utils/logger');
const { run: runExpiryNotifications } = require('../scripts/notifyExpiringCredentials');
const { run: runAnchorBatch } = require('../scripts/anchorDailyBatch');
const { run: runOrganizationPurge } = require('../scripts/purgeExpiredOrganizations');
const { run: runDatabaseBackup } = require('../scripts/backupDatabase');
const { run: runStuckSignupRecovery } = require('../scripts/recoverStuckSignups');

const HANDLERS = {
  'notify-expiring-credentials': () => runExpiryNotifications(),
  'anchor-daily-batch': () => runAnchorBatch(),
  'purge-expired-organizations': () => runOrganizationPurge(),
  'backup-database': () => runDatabaseBackup(),
  'recover-stuck-signups': () => runStuckSignupRecovery(),
};

function startScheduledJobsWorker() {
  if (!process.env.REDIS_URL) {
    logger.info('scheduled_jobs_worker_not_started', { reason: 'REDIS_URL not set' });
    return null;
  }

  const worker = new Worker(
    'scheduled-jobs',
    async (job) => {
      const handler = HANDLERS[job.name];
      if (!handler) throw new Error(`No handler registered for scheduled job "${job.name}"`);
      logger.info('scheduled_job_started', { job: job.name, job_id: job.id, attempt: job.attemptsMade + 1 });
      const result = await handler();
      logger.info('scheduled_job_succeeded', { job: job.name, job_id: job.id, result });
      return result;
    },
    { connection: { url: process.env.REDIS_URL }, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error('scheduled_job_failed', {
      job: job?.name,
      job_id: job?.id,
      attempt: job?.attemptsMade,
      will_retry: (job?.attemptsMade || 0) < (job?.opts?.attempts || 0),
      message: err.message,
    });
  });

  logger.info('scheduled_jobs_worker_started');
  return worker;
}

module.exports = { startScheduledJobsWorker };
