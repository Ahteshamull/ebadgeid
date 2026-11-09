// scripts/syncLms.js
//
// Meant to run on a schedule (e.g. hourly, via cron), same invocation
// pattern as scripts/anchorDailyBatch.js and
// scripts/notifyExpiringCredentials.js:
//   node scripts/syncLms.js
// Pulls any completions each organization's configured LMS sync endpoint
// has for it since the last successful run, and issues credentials for
// anything the webhook (routes/lmsWebhookRoutes.js) hasn't already
// processed. See services/lmsSync.js for the actual logic.
require('dotenv').config();
const mongoose = require('mongoose');
const { syncAllOrganizations } = require('../services/lmsSync');

async function run() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });

  const results = await syncAllOrganizations();
  console.log(JSON.stringify({ event: 'lms_sync_run_complete', organizations: results.length, results }));

  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch(async (error) => {
    console.error(JSON.stringify({ event: 'lms_sync_run_failed', message: error.message }));
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { run };
