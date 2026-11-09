// scripts/notifyExpiringCredentials.js
//
// Meant to run as a daily cron job, same invocation pattern as
// scripts/anchorDailyBatch.js and scripts/migrate.js:
//   node scripts/notifyExpiringCredentials.js [daysAhead]
// Notifies the recipient and the issuing organization's admin(s) that a
// Claimed credential is about to expire -- in-app notification always,
// email best-effort (see utils/expiryNotifications.js for exactly how
// each degrades).
require('dotenv').config();
const mongoose = require('mongoose');
const { notifyExpiringCredentials, DEFAULT_DAYS_AHEAD } = require('../utils/expiryNotifications');

async function run(daysAhead = DEFAULT_DAYS_AHEAD) {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });

  const results = await notifyExpiringCredentials(Number(daysAhead));
  console.log(JSON.stringify({ event: 'expiry_notifications_sent', days_ahead: Number(daysAhead), ...results }));

  await mongoose.disconnect();
}

if (require.main === module) {
  run(process.argv[2]).catch(async (error) => {
    console.error(JSON.stringify({ event: 'expiry_notifications_failed', message: error.message }));
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { run };
