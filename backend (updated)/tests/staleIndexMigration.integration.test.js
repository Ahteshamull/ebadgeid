// tests/staleIndexMigration.integration.test.js
//
// Found by live-testing the payment approval UI against the real running
// stack, not by reading code: approving a real pending signup worked once,
// but creating a second PendingOrgSignup threw a real MongoServerError
// (E11000 duplicate key on stripe_session_id_1, dup key { null }). That
// field doesn't exist anywhere in the current schema or code -- it's a
// unique index left over from before this project migrated off Stripe to
// Tilopay. Mongoose only ever adds indexes for fields the current schema
// declares; it never drops a stale one, so any database that existed
// before that migration keeps a unique index on a field every document
// now shares the same (null) value for -- meaning at most one pending
// signup could ever exist at a time. A brand-new empty-volume deployment
// never creates this index in the first place, so this only bites an
// already-running database being upgraded -- exactly what this migration
// (scripts/migrate.js, 20260823_drop_stale_stripe_session_id_index) and
// this test cover.
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

test('drops the stale stripe_session_id_1 index when present, and unblocks a second document with no stripe_session_id', async () => {
  const { migrations } = require('../scripts/migrate');
  const migration = migrations.find((m) => m.id === '20260823_drop_stale_stripe_session_id_index');
  assert.ok(migration, 'migration must still be registered');

  const db = mongoose.connection.db;
  const collection = db.collection('pendingorgsignups_staleidx_test1');
  // Reproduce the real, pre-Tilopay index shape exactly as it exists on a
  // database that predates the migration -- a plain, non-sparse unique
  // index on a field the current schema never writes.
  await collection.createIndex({ stripe_session_id: 1 }, { unique: true, name: 'stripe_session_id_1' });
  await collection.insertOne({ payment_reference: 'EBID-FIRST', status: 'pending' });

  // Before the fix: this throws E11000 on the shared `null` value.
  await assert.rejects(
    () => collection.insertOne({ payment_reference: 'EBID-SECOND', status: 'pending' }),
    /E11000/,
    'sanity check -- reproduces the real bug before the migration runs'
  );

  const result = await migration.run({ collection: (name) => (name === 'pendingorgsignups' ? collection : db.collection(name)) });
  assert.equal(result.dropped, true);

  await collection.insertOne({ payment_reference: 'EBID-SECOND', status: 'pending' });
  const count = await collection.countDocuments({});
  assert.equal(count, 2, 'a second pending signup with no stripe_session_id must now coexist with the first');
});

test('is a safe no-op when the stale index was never created (a fresh, empty-volume deployment)', async () => {
  const { migrations } = require('../scripts/migrate');
  const migration = migrations.find((m) => m.id === '20260823_drop_stale_stripe_session_id_index');

  const db = mongoose.connection.db;
  const collection = db.collection('pendingorgsignups_staleidx_test2');
  await collection.insertOne({ payment_reference: 'EBID-FRESH-1', status: 'pending' });

  const result = await migration.run({ collection: (name) => (name === 'pendingorgsignups' ? collection : db.collection(name)) });
  assert.equal(result.dropped, false);

  await assert.doesNotReject(() => collection.insertOne({ payment_reference: 'EBID-FRESH-2', status: 'pending' }), 'no unique index means a second document must insert cleanly');
});

// Regression test -- found running the full migrate.js against a
// genuinely brand-new database (never bootstrapped, nothing ever written
// to it), while verifying an unrelated round of fixes end to end.
// Different from the "safe no-op" test above: that one still creates the
// collection first (via insertOne) before running the migration, so
// listIndexes() has a real (empty) collection to list. Here the
// collection is never touched at all -- the namespace itself doesn't
// exist, which is a different, real MongoDB error (NamespaceNotFound),
// not just "zero indexes found".
test('is a safe no-op when the collection itself was never created (nothing has ever written to this database)', async () => {
  const { migrations } = require('../scripts/migrate');
  const migration = migrations.find((m) => m.id === '20260823_drop_stale_stripe_session_id_index');

  const db = mongoose.connection.db;
  const neverTouchedCollectionName = 'pendingorgsignups_staleidx_test4_never_written';
  await assert.rejects(
    () => db.collection(neverTouchedCollectionName).listIndexes().toArray(),
    'sanity check -- real MongoDB must actually throw here, confirming this is a real scenario, not an assumed one'
  );

  const result = await migration.run({ collection: (name) => (name === 'pendingorgsignups' ? db.collection(neverTouchedCollectionName) : db.collection(name)) });
  assert.equal(result.dropped, false);
  assert.equal(result.reason, 'collection not present');
});

test('running it twice in a row (simulating two migrate() invocations before the record is marked applied) is safe', async () => {
  const { migrations } = require('../scripts/migrate');
  const migration = migrations.find((m) => m.id === '20260823_drop_stale_stripe_session_id_index');

  const db = mongoose.connection.db;
  const collection = db.collection('pendingorgsignups_staleidx_test3');
  await collection.createIndex({ stripe_session_id: 1 }, { unique: true, name: 'stripe_session_id_1' });

  const fakeDb = { collection: (name) => (name === 'pendingorgsignups' ? collection : db.collection(name)) };
  const first = await migration.run(fakeDb);
  assert.equal(first.dropped, true);
  const second = await migration.run(fakeDb);
  assert.equal(second.dropped, false, 'the index is already gone by the second call -- must not throw trying to drop it again');
});
