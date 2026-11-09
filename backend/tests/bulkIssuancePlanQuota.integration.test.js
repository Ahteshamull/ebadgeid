// tests/bulkIssuancePlanQuota.integration.test.js
//
// Bulk issuance used to bypass the monthly credential quota completely.
// checkCredentialLimit guards the single-issue route as middleware, but
// the bulk worker calls the controllers directly
// (queues/bulkIssuanceWorker.js), so nothing on the bulk path ever
// consulted the plan: an organization allowed 25 credentials a month
// could enqueue a batch of 2000 and every one would be written.
//
// These tests pin the pre-flight refusal. They assert on the REAL numbers
// in the response too, not just the status code, because the whole point
// of refusing up front is telling the admin exactly how many they have
// left -- a bare 402 would leave them guessing.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { RedisMemoryServer } = require('redis-memory-server');
const { stubEmailTransport } = require('./testHelpers/stubEmailTransport');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only_min_32';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';

let mongod;
let redisServer;
let emailStub;
let app;
let Organization;
let Plan;
let Credential;

const tokenFor = (organization_code) => jwt.sign(
  { id: crypto.randomUUID(), username: `admin@${organization_code}.test`, role: 'admin', organization_code },
  process.env.JWT_SECRET,
  { algorithm: 'HS256' },
);

const recipients = (howMany) => Array.from({ length: howMany }, (_, i) => ({
  achiever_username: `person${i}@quota.test`,
}));

const seedCredentials = (organization_code, howMany) => Promise.all(
  Array.from({ length: howMany }, (_, i) => Credential.create({
    credential_code: `CRED-QUOTA-${organization_code}-${String(i).padStart(4, '0')}`,
    credential_title: 'Seeded', credential_issue_date: '2026-08-01', credential_expiry_date: '2028-08-01',
    credential_pic_url: 'http://localhost:9000/uploads/x.png',
    achiever_username: `seed${i}@quota.test`,
    organization_code, credential_status: 'Issued',
    credential_blockchain_hashes: crypto.createHash('sha256').update(`${organization_code}${i}`).digest('hex'),
  })),
);

test.before(async () => {
  emailStub = stubEmailTransport();
  // A real redis-server, the same way the other bulk-issuance tests do it.
  // The bulk route refuses with 503 when no queue is configured, BEFORE the
  // quota check runs -- so without a working queue these tests would pass
  // for the wrong reason and prove nothing about the quota.
  redisServer = new RedisMemoryServer();
  process.env.REDIS_URL = `redis://${await redisServer.getHost()}:${await redisServer.getPort()}`;

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  Organization = require('../models/organization_schema');
  Plan = require('../models/plan_schema');
  Credential = require('../models/credentialSchema');

  await Plan.create({ name: 'Free', max_users: 5, max_credentials_per_month: 25, max_api_calls_per_month: 500, is_free: true });
  await Plan.create({ name: 'Enterprise', max_users: -1, max_credentials_per_month: -1, max_api_calls_per_month: -1, is_free: false });

  await Organization.create({
    organization_code: 'ORG-QUOTA', name: 'Quota Co', city: 'C', state: 'S', country: 'CR',
    email: 'q@test.local', phone: '0', status: 'ACTIVE', plan: 'Free',
  });
  await Organization.create({
    organization_code: 'ORG-UNLIMITED', name: 'Unlimited Co', city: 'C', state: 'S', country: 'CR',
    email: 'u@test.local', phone: '0', status: 'ACTIVE', plan: 'Enterprise',
  });
  await Organization.create({
    organization_code: 'ORG-NOPLAN', name: 'Drifted Co', city: 'C', state: 'S', country: 'CR',
    email: 'n@test.local', phone: '0', status: 'ACTIVE', plan: 'Premium', // no such Plan document seeded
  });

  // 20 of the 25 monthly allowance already used.
  await seedCredentials('ORG-QUOTA', 20);
});

test.after(async () => {
  // BullMQ holds an open Redis connection for the bulk queue; without
  // closing it the process never exits and the runner cancels the file
  // even though every assertion passed.
  emailStub.restore();
  const { getQueue } = require('../queues/bulkIssuanceQueue');
  const queue = getQueue();
  if (queue) await queue.close();
  if (redisServer) await redisServer.stop();
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test('a batch larger than the remaining monthly quota is refused before anything is enqueued', async () => {
  const res = await request(app).post('/api/credentials/bulk-issue')
    .set('Authorization', `Bearer ${tokenFor('ORG-QUOTA')}`)
    .send({ recipients: recipients(100), design_code: 'TPL-TEST', credential_title: 'Test' });

  assert.equal(res.status, 402, 'an over-quota batch must be refused, not accepted and half-processed');
  // The admin has to be able to act on this, so the real figures matter.
  assert.equal(res.body.limit, 25);
  assert.equal(res.body.used, 20);
  assert.equal(res.body.remaining, 5);
  assert.equal(res.body.requested, 100);
  assert.match(res.body.message, /5 remain/);
});

test('a batch that fits the remaining quota is not refused by the quota check', async () => {
  const res = await request(app).post('/api/credentials/bulk-issue')
    .set('Authorization', `Bearer ${tokenFor('ORG-QUOTA')}`)
    .send({ recipients: recipients(5), design_code: 'TPL-TEST', credential_title: 'Test' });

  // It may still fail later for an unrelated reason (no live Redis in this
  // environment), but it must NOT be the 402 quota refusal.
  assert.notEqual(res.status, 402, `a batch within quota must pass the quota gate (got ${res.status}: ${JSON.stringify(res.body)})`);
});

test('an unlimited plan is never refused on quota grounds', async () => {
  const res = await request(app).post('/api/credentials/bulk-issue')
    .set('Authorization', `Bearer ${tokenFor('ORG-UNLIMITED')}`)
    .send({ recipients: recipients(500), design_code: 'TPL-TEST', credential_title: 'Test' });
  assert.notEqual(res.status, 402, 'an unlimited plan must not hit the quota refusal');
});

test('an organization whose plan is not configured is refused, never treated as unlimited', async () => {
  const res = await request(app).post('/api/credentials/bulk-issue')
    .set('Authorization', `Bearer ${tokenFor('ORG-NOPLAN')}`)
    .send({ recipients: recipients(10), design_code: 'TPL-TEST', credential_title: 'Test' });
  assert.equal(res.status, 402, 'unconfigured plan must fail closed');
  assert.match(res.body.message, /no plan with that name is configured/i);
});

test('the pre-flight allowance endpoint reports the same numbers the route enforces', async () => {
  const res = await request(app)
    .get('/api/credentials/bulk-issue/allowance?requested=100')
    .set('Authorization', `Bearer ${tokenFor('ORG-QUOTA')}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.limit, 25);
  assert.equal(res.body.used, 20);
  assert.equal(res.body.remaining, 5);
  assert.equal(res.body.requested, 100);
  assert.equal(res.body.can_issue, false, 'the confirmation screen must know this batch cannot proceed');

  const fits = await request(app)
    .get('/api/credentials/bulk-issue/allowance?requested=5')
    .set('Authorization', `Bearer ${tokenFor('ORG-QUOTA')}`);
  assert.equal(fits.body.can_issue, true);
});

test('the allowance endpoint is scoped to the caller organization', async () => {
  const mine = await request(app).get('/api/credentials/bulk-issue/allowance')
    .set('Authorization', `Bearer ${tokenFor('ORG-QUOTA')}`);
  const theirs = await request(app).get('/api/credentials/bulk-issue/allowance')
    .set('Authorization', `Bearer ${tokenFor('ORG-UNLIMITED')}`);

  assert.equal(mine.body.plan_name, 'Free');
  assert.equal(theirs.body.plan_name, 'Enterprise');
  assert.notEqual(mine.body.remaining, theirs.body.remaining);
});

test('an unauthenticated caller cannot read another organization allowance', async () => {
  const res = await request(app).get('/api/credentials/bulk-issue/allowance');
  assert.equal(res.status, 401);
});

// --- Concurrencia ----------------------------------------------------------
// Reading the allowance and then enqueueing is two steps. Two admins
// submitting 15 each against 15 remaining would both read 15, both pass, and
// 30 credentials would be issued on a 25-a-month plan. The reservation is
// what closes that, and only a genuinely concurrent test can prove it: a
// sequential one passes even with the broken check-then-act version.

test('two simultaneous batches cannot both spend the same remaining quota', async () => {
  const Organization = require('../models/organization_schema');
  const Plan = require('../models/plan_schema');

  await Plan.findOneAndUpdate(
    { name: 'Basic' },
    { name: 'Basic', max_users: 25, max_credentials_per_month: 30, max_api_calls_per_month: 5000, is_free: false },
    { upsert: true },
  );
  await Organization.create({
    organization_code: 'ORG-RACE', name: 'Race Co', city: 'C', state: 'S', country: 'CR',
    email: 'race@test.local', phone: '0', status: 'ACTIVE', plan: 'Basic',
  });
  // 15 of 30 already used, so exactly 15 remain.
  await seedCredentials('ORG-RACE', 15);

  const token = tokenFor('ORG-RACE');
  const submit = () => request(app).post('/api/credentials/bulk-issue')
    .set('Authorization', `Bearer ${token}`)
    .send({ recipients: recipients(15), design_code: 'TPL-TEST', credential_title: 'Race' });

  // Both in flight before either finishes.
  const [a, b] = await Promise.all([submit(), submit()]);
  const statuses = [a.status, b.status].sort();

  const accepted = [a, b].filter((r) => r.status !== 402);
  const refused = [a, b].filter((r) => r.status === 402);

  assert.equal(accepted.length, 1,
    `exactly one batch may be accepted, got statuses ${JSON.stringify(statuses)}`);
  assert.equal(refused.length, 1, 'the loser must be refused with 402');
  assert.equal(refused[0].body.requested, 15);

  // And the reservation reflects only the winner.
  const org = await Organization.findOne({ organization_code: 'ORG-RACE' }).lean();
  assert.equal(org.bulk_reserved_count, 15,
    'the counter must show one reservation of 15, not two');
});

test('a reservation is handed back when the batch is only held for approval', async () => {
  const Organization = require('../models/organization_schema');
  await Organization.create({
    organization_code: 'ORG-HOLD', name: 'Hold Co', city: 'C', state: 'S', country: 'CR',
    email: 'hold@test.local', phone: '0', status: 'ACTIVE', plan: 'Basic',
    require_bulk_approval: true,
  });

  const res = await request(app).post('/api/credentials/bulk-issue')
    .set('Authorization', `Bearer ${tokenFor('ORG-HOLD')}`)
    .send({ recipients: recipients(5), design_code: 'TPL-TEST', credential_title: 'Held' });
  assert.equal(res.status, 202);
  assert.equal(res.body.status, 'pending_approval');

  const org = await Organization.findOne({ organization_code: 'ORG-HOLD' }).lean();
  assert.equal(org.bulk_reserved_count, 0,
    'nothing is being issued yet, so nothing may stay reserved');
});

test('an unlimited plan reserves nothing -- there is nothing to run out of', async () => {
  const Organization = require('../models/organization_schema');
  await request(app).post('/api/credentials/bulk-issue')
    .set('Authorization', `Bearer ${tokenFor('ORG-UNLIMITED')}`)
    .send({ recipients: recipients(50), design_code: 'TPL-TEST', credential_title: 'Unlimited' });

  const org = await Organization.findOne({ organization_code: 'ORG-UNLIMITED' }).lean();
  assert.equal(org.bulk_reserved_count, 0);
});
