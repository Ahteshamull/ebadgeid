const mongoose = require('mongoose');
const dns = require('dns');
if (process.env.MONGO_URI && process.env.MONGO_URI.startsWith('mongodb+srv://')) {
  try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (_) {}
}
const logger = require('../utils/logger');
const Plan = require('../models/plan_schema');
const { DEFAULT_PLANS } = require('../models/plan_schema');

// Ensures the four plan tiers exist so limit enforcement always has
// something to look up — no manual seed step required after a fresh
// deploy. Idempotent: upserts, so re-running it (every boot) never
// duplicates or clobbers limits an admin may have already adjusted for a
// tier that already exists — it only fills in tiers that are missing.
const seedDefaultPlans = async () => {
  for (const plan of DEFAULT_PLANS) {
    // eslint-disable-next-line no-await-in-loop
    await Plan.updateOne(
      { name: plan.name },
      { $setOnInsert: plan },
      { upsert: true }
    );
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// AUD-105 + AUD-106 (see AUDIT_FIXES.md): mongoose.connect() had no
// options, so it used the driver's default serverSelectionTimeoutMS
// (~30s) — meaning every request touching the database, not just the
// initial connection, could hang for up to 30 seconds before failing if
// MongoDB were ever unreachable. Fixing that naively (just lowering the
// timeout) uncovered a second, pre-existing issue: the very next line was
// `process.exit(1)` on any connection failure, with no retry — so a
// faster timeout just meant the whole process died faster too. That
// matters concretely here because docker-compose.yml's `depends_on` for
// this service isn't health-check-gated (see
// DOCKER_INFRASTRUCTURE_AUDIT.md) — MongoDB starting a few seconds slower
// than this API container is a realistic, ordinary case on `docker
// compose up`, not an edge case.
//
// The fix that actually addresses both without hiding a real outage:
// retry a bounded number of times with backoff before giving up. Each
// individual attempt still fails fast (5s) so a request never hangs long;
// a slow-starting MongoDB gets tolerated across the retry window (~31s
// total, similar to the old single-attempt timeout it replaces); a
// genuinely unreachable MongoDB still ends in the same loud
// process.exit(1) as before, so a real outage is never silently masked.
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

const connectDB = async () => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
      });
      logger.info('mongodb_connected', { attempt });
      await seedDefaultPlans();
      return;
    } catch (error) {
      const isLastAttempt = attempt === MAX_RETRIES;
      logger.error('mongodb_connection_attempt_failed', {
        attempt,
        max_retries: MAX_RETRIES,
        message: error.message,
        giving_up: isLastAttempt,
      });
      if (isLastAttempt) {
        process.exit(1);
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1)); // 1s, 2s, 4s, 8s
    }
  }
};

module.exports = connectDB;
