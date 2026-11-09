// tests/seatCountBackfillMigration.integration.test.js
//
// HIGH-02 fix: organization_schema.js's new seat_count field is the atomic
// reservation counter middleware/enforcePlanLimits.js's wouldExceedUserLimit
// now uses. This migration (scripts/migrate.js,
// 20260827_backfill_organization_seat_count) backfills it for every
// organization that predates the field, from the REAL Users count -- this
// proves it starts accurate, not at the schema's own `default: 0`, which
// would otherwise falsely give every already-populated organization extra
// "free" seats until it happened to self-correct some other way.
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

function fakeDb(map) {
  return { collection: (name) => map[name] };
}

test('backfills seat_count from the real Users count for every organization missing the field', async () => {
  const { migrations } = require('../scripts/migrate');
  const migration = migrations.find((m) => m.id === '20260827_backfill_organization_seat_count');
  assert.ok(migration, 'migration must still be registered');

  const db = mongoose.connection.db;
  const organizations = db.collection('orgs_seatbackfill_test1');
  const users = db.collection('users_seatbackfill_test1');

  await organizations.insertMany([
    { organization_code: 'ORG-BACKFILL-A' }, // no seat_count -- 3 real users
    { organization_code: 'ORG-BACKFILL-B' }, // no seat_count -- 0 real users
    { organization_code: 'ORG-BACKFILL-C', seat_count: 7 }, // already has it -- must be left untouched
  ]);
  await users.insertMany([
    { organization_code: 'ORG-BACKFILL-A', username: 'a1' },
    { organization_code: 'ORG-BACKFILL-A', username: 'a2' },
    { organization_code: 'ORG-BACKFILL-A', username: 'a3' },
    { organization_code: 'ORG-BACKFILL-C', username: 'c1' }, // real count (1) deliberately differs from the existing seat_count (7) -- must not be touched
  ]);

  const result = await migration.run(fakeDb({ organizations, users }));
  assert.equal(result.organizations_backfilled, 2, 'only the 2 orgs missing seat_count get touched');

  const byCode = Object.fromEntries((await organizations.find({}).toArray()).map((o) => [o.organization_code, o]));
  assert.equal(byCode['ORG-BACKFILL-A'].seat_count, 3, 'must backfill from the real Users count, not leave it at 0');
  assert.equal(byCode['ORG-BACKFILL-B'].seat_count, 0, 'an organization with genuinely zero users backfills to 0');
  assert.equal(byCode['ORG-BACKFILL-C'].seat_count, 7, 'an organization that already has seat_count must never be overwritten by this migration, even if it looks stale');
});

test('is a safe no-op when every organization already has seat_count', async () => {
  const { migrations } = require('../scripts/migrate');
  const migration = migrations.find((m) => m.id === '20260827_backfill_organization_seat_count');

  const db = mongoose.connection.db;
  const organizations = db.collection('orgs_seatbackfill_test2');
  const users = db.collection('users_seatbackfill_test2');
  await organizations.insertOne({ organization_code: 'ORG-BACKFILL-NOOP', seat_count: 2 });

  const result = await migration.run(fakeDb({ organizations, users }));
  assert.equal(result.organizations_backfilled, 0);

  const org = await organizations.findOne({ organization_code: 'ORG-BACKFILL-NOOP' });
  assert.equal(org.seat_count, 2);
});
