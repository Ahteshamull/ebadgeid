// tests/planIsFreeMigration.integration.test.js
//
// Security fix, found live during an audit round: selfServiceSignup.js
// used to decide "is this plan free?" by checking `!plan.price_cents`.
// On any database seeded before this fix, every plan -- including
// Enterprise, with unlimited users/credentials/API calls -- had
// price_cents: null (pricing is set after deploy, not at seed time), so
// every plan was silently free. Reproduced live: an anonymous self-signup
// for Enterprise provisioned immediately, no payment, no platform_admin
// approval. plan_schema.js now has an explicit `is_free` field the app
// trusts instead (see selfServiceSignup.js's startSignup), but Mongoose's
// schema `default` only fills in a field that's entirely absent, and only
// ever to the same value for every document -- it can't retroactively
// make just the Free plan true on a database that already has these four
// plan documents from before this fix. This migration
// (scripts/migrate.js, 20260824_add_plan_is_free_flag) and this test
// cover that upgrade path.
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

test('sets is_free:true on the Free plan and is_free:false on the others, reproducing and then fixing the exact exploitable pre-fix state', async () => {
  const { migrations } = require('../scripts/migrate');
  const migration = migrations.find((m) => m.id === '20260824_add_plan_is_free_flag');
  assert.ok(migration, 'migration must still be registered');

  const db = mongoose.connection.db;
  const collection = db.collection('plans_isfree_test1');
  // Reproduce the real pre-fix state exactly: four plans, all with
  // price_cents: null, none with an is_free field at all.
  await collection.insertMany([
    { name: 'Free', max_users: 5, price_cents: null },
    { name: 'Basic', max_users: 25, price_cents: null },
    { name: 'Premium', max_users: 150, price_cents: null },
    { name: 'Enterprise', max_users: -1, price_cents: null },
  ]);

  const result = await migration.run({ collection: (name) => (name === 'plans' ? collection : db.collection(name)) });
  assert.equal(result.free_plan_updated, 1);
  assert.equal(result.other_plans_defaulted, 3);

  const plans = await collection.find({}).toArray();
  const byName = Object.fromEntries(plans.map((p) => [p.name, p]));
  assert.equal(byName.Free.is_free, true);
  assert.equal(byName.Basic.is_free, false);
  assert.equal(byName.Premium.is_free, false);
  assert.equal(byName.Enterprise.is_free, false, 'the exact plan that was exploitable for a free signup must end up explicitly non-free');
});

test('is a safe no-op when plans already have is_free set correctly', async () => {
  const { migrations } = require('../scripts/migrate');
  const migration = migrations.find((m) => m.id === '20260824_add_plan_is_free_flag');

  const db = mongoose.connection.db;
  const collection = db.collection('plans_isfree_test2');
  await collection.insertMany([
    { name: 'Free', is_free: true, price_cents: null },
    { name: 'Enterprise', is_free: false, price_cents: null },
  ]);

  const result = await migration.run({ collection: (name) => (name === 'plans' ? collection : db.collection(name)) });
  assert.equal(result.free_plan_updated, 0);
  assert.equal(result.other_plans_defaulted, 0);
});

test('running it twice in a row is safe and idempotent', async () => {
  const { migrations } = require('../scripts/migrate');
  const migration = migrations.find((m) => m.id === '20260824_add_plan_is_free_flag');

  const db = mongoose.connection.db;
  const collection = db.collection('plans_isfree_test3');
  await collection.insertMany([
    { name: 'Free', price_cents: null },
    { name: 'Enterprise', price_cents: null },
  ]);

  const fakeDb = { collection: (name) => (name === 'plans' ? collection : db.collection(name)) };
  const first = await migration.run(fakeDb);
  assert.equal(first.free_plan_updated, 1);
  assert.equal(first.other_plans_defaulted, 1);

  const second = await migration.run(fakeDb);
  assert.equal(second.free_plan_updated, 0, 'already true -- must not match $ne:true again');
  assert.equal(second.other_plans_defaulted, 0, 'already has the field -- must not match $exists:false again');
});
