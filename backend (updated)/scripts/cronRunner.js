// scripts/cronRunner.js
//
// Entry point for the "cron" service in docker-compose.yml. Registers the
// two scheduled jobs (queues/scheduledJobsQueue.js) and starts the worker
// that actually executes them (queues/scheduledJobsWorker.js) -- both
// backed by the same real Redis/BullMQ infrastructure already used for
// bulk credential issuance (queues/bulkIssuanceQueue.js), not a
// standalone timer. See PRODUCTION_RUNBOOK.md's "Cron / trabajos
// programados" section for where the schedule is configured, how to
// change it, and how this survives a server reboot.
require('dotenv').config();
const logger = require('../utils/logger');
const { registerSchedules } = require('../queues/scheduledJobsQueue');
const { startScheduledJobsWorker } = require('../queues/scheduledJobsWorker');

// A crash that only logs and leaves the process technically alive (no
// exit, so no container restart, but also no longer actually processing
// anything) is worse than a clean restart -- docker-compose's
// `restart: unless-stopped` on this service only helps if the process
// actually exits when something fatal happens.
process.on('uncaughtException', (err) => {
  logger.error('cron_service_uncaught_exception', { message: err.message, stack: err.stack });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('cron_service_unhandled_rejection', { message: reason?.message || String(reason) });
  process.exit(1);
});

async function start() {
  const schedule = await registerSchedules();
  startScheduledJobsWorker();
  logger.info('cron_runner_started', { schedule });
}

if (require.main === module) {
  start().catch((err) => {
    logger.error('cron_runner_failed_to_start', { message: err.message });
    process.exit(1);
  });
}

module.exports = { start };
