// scripts/anchorDailyBatch.js
//
// Meant to run as a daily cron job (the user's own suggestion: "corrido
// como un cron job diario, no en tiempo real"), same invocation pattern as
// scripts/migrate.js in this same directory: `node scripts/anchorDailyBatch.js`,
// connects, does its work, disconnects, exits non-zero on failure so a
// cron/CI runner notices.
//
// Anchors YESTERDAY's batch by default, not today's -- run this once a
// day after midnight and every credential issued the previous day is
// already final; anchoring "today" while the day is still in progress
// would mean re-anchoring (a new transaction, a new cost) every time a
// credential is issued later that day.
require('dotenv').config();
const mongoose = require('mongoose');
const { buildBatchForDate, anchorBatch, isConfigured } = require('../services/blockchainAnchor');

function yesterday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

async function run(batchDate = yesterday()) {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });

  const batch = await buildBatchForDate(batchDate);
  if (!batch) {
    console.log(JSON.stringify({ event: 'anchor_skipped', batch_date: batchDate, reason: 'no credentials issued that day' }));
    await mongoose.disconnect();
    return;
  }

  if (!isConfigured()) {
    console.log(JSON.stringify({
      event: 'anchor_batch_built_not_anchored',
      batch_date: batchDate,
      merkle_root: batch.merkle_root,
      credential_count: batch.entries.length,
      reason: 'BLOCKCHAIN_RPC_URL / BLOCKCHAIN_PRIVATE_KEY not configured -- batch is built and verifiable but not yet written on-chain',
    }));
    await mongoose.disconnect();
    return;
  }

  const anchored = await anchorBatch(batchDate);
  console.log(JSON.stringify({
    event: 'anchor_batch_anchored',
    batch_date: batchDate,
    merkle_root: anchored.merkle_root,
    tx_hash: anchored.tx_hash,
    chain: anchored.chain,
  }));
  await mongoose.disconnect();
}

if (require.main === module) {
  run(process.argv[2]).catch(async (error) => {
    console.error(JSON.stringify({ event: 'anchor_batch_failed', message: error.message }));
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { run, yesterday };
