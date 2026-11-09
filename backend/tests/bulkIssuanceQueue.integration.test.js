// tests/bulkIssuanceQueue.integration.test.js
//
// Real integration test against a real Redis (redis-memory-server downloads
// and runs an actual redis-server binary) and real BullMQ — not a mocked
// queue. Covers the P2 fix from the final validation round:
// GET /bulk-issue/:batchId used to look a batch up by batchId alone, so an
// admin from one organization who knew or guessed another org's batchId
// could read that org's bulk-issuance progress. getBatchStatus now requires
// organization_code to match too.
const test = require('node:test');
const assert = require('node:assert/strict');

const { RedisMemoryServer } = require('redis-memory-server');
const { stubEmailTransport } = require('./testHelpers/stubEmailTransport');
let emailStub;

let redisServer;

test.before(async () => {
  emailStub = stubEmailTransport();
  redisServer = new RedisMemoryServer();
  const host = await redisServer.getHost();
  const port = await redisServer.getPort();
  process.env.REDIS_URL = `redis://${host}:${port}`;
});

test.after(async () => {
  emailStub.restore();
  const { getQueue } = require('../queues/bulkIssuanceQueue');
  const q = getQueue();
  if (q) await q.close();
  await redisServer.stop();
});

test('enqueueBulkIssuance + getBatchStatus returns correct totals for the owning organization', async () => {
  const { enqueueBulkIssuance, getBatchStatus } = require('../queues/bulkIssuanceQueue');

  const { batchId, total } = await enqueueBulkIssuance({
    recipients: [
      { achiever_username: 'alice' },
      { achiever_username: 'bob' },
      { achiever_username: 'Guest One', guest_recipient: { email: 'g1@example.com', first_name: 'Guest', last_name: 'One' } },
    ],
    design_code: 'DESIGN-1',
    credential_title: 'Test Certificate',
    organization_code: 'ORG-X',
    requested_by: 'admin-x',
  });

  assert.equal(total, 3);

  const status = await getBatchStatus(batchId, 'ORG-X');
  assert.ok(status);
  assert.equal(status.total, 3);
  assert.equal(status.batchId, batchId);
});

test('getBatchStatus returns null when the batchId belongs to a different organization (cross-tenant leak, P2 fix)', async () => {
  const { enqueueBulkIssuance, getBatchStatus } = require('../queues/bulkIssuanceQueue');

  const { batchId } = await enqueueBulkIssuance({
    recipients: [{ achiever_username: 'carol' }],
    design_code: 'DESIGN-2',
    credential_title: 'Another Certificate',
    organization_code: 'ORG-Y',
    requested_by: 'admin-y',
  });

  // A different, real organization asking about ORG-Y's batch must get
  // exactly the same "not found" response as a made-up batchId would — see
  // the next test — never the real progress counts.
  const status = await getBatchStatus(batchId, 'ORG-Z');
  assert.equal(status, null);

  // The rightful owner still gets it.
  const ownStatus = await getBatchStatus(batchId, 'ORG-Y');
  assert.ok(ownStatus);
  assert.equal(ownStatus.total, 1);
});

test('getBatchStatus returns null (not a thrown error) for a completely unknown batchId', async () => {
  const { getBatchStatus } = require('../queues/bulkIssuanceQueue');
  const status = await getBatchStatus('batch-does-not-exist-00000000', 'ORG-X');
  assert.equal(status, null);
});

test('a cross-tenant lookup and an unknown batchId are indistinguishable (both null) — no oracle for guessing valid batchIds', async () => {
  const { enqueueBulkIssuance, getBatchStatus } = require('../queues/bulkIssuanceQueue');

  const { batchId } = await enqueueBulkIssuance({
    recipients: [{ achiever_username: 'dave' }],
    design_code: 'DESIGN-3',
    credential_title: 'Yet Another Certificate',
    organization_code: 'ORG-REAL',
    requested_by: 'admin-real',
  });

  const crossTenant = await getBatchStatus(batchId, 'ORG-ATTACKER');
  const unknown = await getBatchStatus('batch-totally-made-up-11111111', 'ORG-ATTACKER');
  assert.equal(crossTenant, unknown);
  assert.equal(crossTenant, null);
});
