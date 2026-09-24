// tests/scoreNormalizationMigration.integration.test.js
//
// E2E audit finding H-08: the 20260815_normalize_scores_to_numbers
// migration used to throw on the first Score document whose string value
// couldn't be safely converted to a number, aborting the entire run --
// and since a migration is only marked "applied" after it fully succeeds,
// every subsequent `npm run migrate` would hit the same document and fail
// again, permanently. Now it skips and logs the bad document instead.
// Real MongoDB (mongodb-memory-server), the real migrations array from
// scripts/migrate.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('a single unconvertible Score value is skipped and logged, and every other document in the same run still gets normalized', async () => {
  const { migrations } = require('../scripts/migrate');
  const migration = migrations.find((m) => m.id === '20260815_normalize_scores_to_numbers');
  assert.ok(migration, 'migration must still be registered');

  const db = mongoose.connection.db;
  const scores = db.collection('scores');
  await scores.insertMany([
    { organization_code: 'ORG-MIG-A', username: 'good_user_1', goal_code: 'GOAL-1', score: '42' },
    { organization_code: 'ORG-MIG-A', username: 'bad_user', goal_code: 'GOAL-1', score: 'not-a-number-at-all' },
    { organization_code: 'ORG-MIG-A', username: 'good_user_2', goal_code: 'GOAL-1', score: '17' },
  ]);

  const result = await migration.run(db);
  assert.equal(result.migrated, 2, 'both convertible documents must be normalized despite the one bad document in between');
  assert.deepEqual(result.skipped.length, 1, 'exactly the one unconvertible document must be reported as skipped, not silently dropped');

  const good1 = await scores.findOne({ username: 'good_user_1' });
  const good2 = await scores.findOne({ username: 'good_user_2' });
  const bad = await scores.findOne({ username: 'bad_user' });
  assert.equal(good1.score, 42);
  assert.equal(typeof good1.score, 'number');
  assert.equal(good2.score, 17);
  assert.equal(typeof good2.score, 'number');
  assert.equal(bad.score, 'not-a-number-at-all', 'the bad document is left as-is for manual remediation, never silently coerced to something wrong');
});

test('the migration run itself does not throw, so the outer migrate() marks it applied and never retries the same bad document forever', async () => {
  const { migrations } = require('../scripts/migrate');
  const migration = migrations.find((m) => m.id === '20260815_normalize_scores_to_numbers');
  const db = mongoose.connection.db;
  const scores = db.collection('scores');
  const inserted = await scores.insertOne({ organization_code: 'ORG-MIG-B', username: 'permanently_bad_user', goal_code: 'GOAL-1', score: 'NaN-forever' });

  await assert.doesNotReject(() => migration.run(db), 'a bad document must never cause the migration function itself to throw');

  // Running it again (simulating the next `npm run migrate` invocation)
  // must not error either, and this specific document must still be
  // reported as skipped every time (so it stays visible for
  // remediation), never silently forgotten or miscounted as migrated.
  const secondRun = await migration.run(db);
  assert.ok(secondRun.skipped.includes(String(inserted.insertedId)), 'this specific still-bad document must be reported as skipped again on the second run');
  const stillUnconverted = await scores.findOne({ _id: inserted.insertedId });
  assert.equal(stillUnconverted.score, 'NaN-forever', 'never silently coerced to 0 or dropped -- left exactly as-is for a human to fix');
});
