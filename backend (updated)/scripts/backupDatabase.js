// scripts/backupDatabase.js
//
// Same invocation pattern as scripts/anchorDailyBatch.js and
// scripts/migrate.js: `node scripts/backupDatabase.js`, connects, does
// its work, exits non-zero on failure so a cron/CI runner notices. Runs
// on the schedule configured in queues/scheduledJobsQueue.js. See
// services/backupService.js for what "backup" actually does.
require('dotenv').config();
const { createBackup } = require('../services/backupService');

async function run() {
  const result = await createBackup();
  console.log(JSON.stringify({
    event: 'backup_run_complete',
    backup_dir: result.backupDir,
    databases: Object.fromEntries(Object.entries(result.manifest.databases).map(([db, cols]) => [db, Object.keys(cols).length])),
  }));
  return result;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(JSON.stringify({ event: 'backup_run_failed', message: error.message }));
    process.exit(1);
  });
}

module.exports = { run };
