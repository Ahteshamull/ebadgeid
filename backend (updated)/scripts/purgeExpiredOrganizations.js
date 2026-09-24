// scripts/purgeExpiredOrganizations.js
//
// Same invocation pattern as scripts/anchorDailyBatch.js and
// scripts/migrate.js in this directory: `node scripts/purgeExpiredOrganizations.js`,
// connects, does its work, disconnects, exits non-zero on failure so a
// cron/CI runner notices. See services/organizationPurgeService.js for
// what "purge" actually does and why (E2E audit H-22 follow-up).
require('dotenv').config();
const mongoose = require('mongoose');
const { purgeExpiredOrganizations } = require('../services/organizationPurgeService');

async function run() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });

  const result = await purgeExpiredOrganizations();
  console.log(JSON.stringify({ event: 'organization_purge_run_complete', ...result }));
  await mongoose.disconnect();
  return result;
}

if (require.main === module) {
  run().catch(async (error) => {
    console.error(JSON.stringify({ event: 'organization_purge_run_failed', message: error.message }));
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { run };
