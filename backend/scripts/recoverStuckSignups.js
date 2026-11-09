// scripts/recoverStuckSignups.js
//
// Same invocation pattern as scripts/purgeExpiredOrganizations.js and
// scripts/anchorDailyBatch.js in this directory: `node scripts/recoverStuckSignups.js`,
// connects, does its work, disconnects, exits non-zero on failure so a
// cron/CI runner notices. See services/selfServiceSignup.js's
// recoverStuckProvisioningSignups() for what this actually recovers and why.
require('dotenv').config();
const mongoose = require('mongoose');
const { recoverStuckProvisioningSignups } = require('../services/selfServiceSignup');

async function run() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });

  const result = await recoverStuckProvisioningSignups();
  console.log(JSON.stringify({ event: 'stuck_signup_recovery_run_complete', ...result }));
  await mongoose.disconnect();
  return result;
}

if (require.main === module) {
  run().catch(async (error) => {
    console.error(JSON.stringify({ event: 'stuck_signup_recovery_run_failed', message: error.message }));
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { run };
