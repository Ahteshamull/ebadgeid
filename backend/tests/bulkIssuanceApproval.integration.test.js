// tests/bulkIssuanceApproval.integration.test.js
//
// Real HTTP against the real app (api.js), real MongoDB, real Redis
// (redis-memory-server -- the approval flow ends in enqueueBulkIssuance,
// which needs a real queue to prove approval actually enqueues something,
// not just flips a status field).
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { RedisMemoryServer } = require('redis-memory-server');
const { stubEmailTransport } = require('./testHelpers/stubEmailTransport');
let emailStub;

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';

let mongod;
let redisServer;
let app;

const ORG = 'ORG-BULK-APPROVAL';
let token;

test.before(async () => {
  emailStub = stubEmailTransport();
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  redisServer = new RedisMemoryServer();
  const host = await redisServer.getHost();
  const port = await redisServer.getPort();
  process.env.REDIS_URL = `redis://${host}:${port}`;

  ({ app } = require('../api.js'));
  token = jwt.sign({ id: 'a1', username: 'bulk_admin', role: 'admin', organization_code: ORG }, process.env.JWT_SECRET, { algorithm: 'HS256' });

  const Organization = require('../models/organization_schema');
  const Plan = require('../models/plan_schema');
  // The organizations below name the "Basic" plan, so that plan has to
  // exist. Bulk issuance now checks the monthly credential quota before
  // enqueueing anything, and an organization whose plan name matches no
  // Plan document fails CLOSED rather than being treated as unlimited --
  // so without this seed these tests would get a 402 and never reach the
  // approval behaviour they are actually about.
  await Plan.create({
    name: 'Basic', max_users: 50, max_credentials_per_month: 500,
    max_api_calls_per_month: 10000, is_free: false,
  });
  await Organization.create({
    organization_code: ORG, name: 'Bulk Approval Org', city: 'C', state: 'S', country: 'PY',
    email: 'bulkapproval@example.test', phone: '0', status: 'ACTIVE', plan: 'Basic',
    require_bulk_approval: true,
  });
});

test.after(async () => {
  emailStub.restore();
  const { getQueue } = require('../queues/bulkIssuanceQueue');
  const q = getQueue();
  if (q) await q.close();
  await mongoose.disconnect();
  await mongod.stop();
  await redisServer.stop();
});

test('POST /bulk-issue creates a pending approval instead of enqueueing, when the org requires approval', async () => {
  const res = await request(app)
    .post('/api/credentials/bulk-issue')
    .set('Authorization', `Bearer ${token}`)
    .send({ recipients: [{ achiever_username: 'alice' }, { achiever_username: 'bob' }], design_code: 'DESIGN-1', credential_title: 'Test' });

  assert.equal(res.status, 202);
  assert.equal(res.body.status, 'pending_approval');
  assert.ok(res.body.pending_approval_id);

  const { getBatchStatus } = require('../queues/bulkIssuanceQueue');
  const status = await getBatchStatus(res.body.pending_approval_id, ORG);
  assert.equal(status, null, 'nothing must be enqueued while the request is only pending');
});

test('GET /bulk-issue/pending lists the pending request for the org', async () => {
  const res = await request(app)
    .get('/api/credentials/bulk-issue/pending')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.count >= 1);
  assert.ok(res.body.pending[0].requested_by);
  assert.equal(res.body.pending[0].recipients, undefined, 'the list view should not include the full recipients array');
});

test('POST /bulk-issue/:id/approve actually enqueues the real batch and records who approved it', async () => {
  const createRes = await request(app)
    .post('/api/credentials/bulk-issue')
    .set('Authorization', `Bearer ${token}`)
    .send({ recipients: [{ achiever_username: 'carol' }], design_code: 'DESIGN-1', credential_title: 'Test' });
  const pendingId = createRes.body.pending_approval_id;

  const approveRes = await request(app)
    .post(`/api/credentials/bulk-issue/${pendingId}/approve`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.body.status, 'approved');
  assert.ok(approveRes.body.batchId);
  assert.equal(approveRes.body.approved_by, 'bulk_admin');

  const { getBatchStatus } = require('../queues/bulkIssuanceQueue');
  const status = await getBatchStatus(approveRes.body.batchId, ORG);
  assert.ok(status, 'approving must actually enqueue a real batch');
  assert.equal(status.total, 1);

  const BulkIssuanceApproval = require('../models/bulkIssuanceApproval');
  const record = await BulkIssuanceApproval.findById(pendingId);
  assert.equal(record.status, 'approved');
  assert.equal(record.reviewed_by, 'bulk_admin');
  assert.ok(record.reviewed_at instanceof Date);
});

test('POST /bulk-issue/:id/reject never enqueues anything and records the rejection', async () => {
  const createRes = await request(app)
    .post('/api/credentials/bulk-issue')
    .set('Authorization', `Bearer ${token}`)
    .send({ recipients: [{ achiever_username: 'dave' }], design_code: 'DESIGN-1', credential_title: 'Test' });
  const pendingId = createRes.body.pending_approval_id;

  const rejectRes = await request(app)
    .post(`/api/credentials/bulk-issue/${pendingId}/reject`)
    .set('Authorization', `Bearer ${token}`)
    .send({ reason: 'Wrong recipient list' });

  assert.equal(rejectRes.status, 200);
  assert.equal(rejectRes.body.status, 'rejected');

  const BulkIssuanceApproval = require('../models/bulkIssuanceApproval');
  const record = await BulkIssuanceApproval.findById(pendingId);
  assert.equal(record.status, 'rejected');
  assert.equal(record.rejection_reason, 'Wrong recipient list');

  // Approving an already-rejected request must not be possible
  const secondApprove = await request(app)
    .post(`/api/credentials/bulk-issue/${pendingId}/approve`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(secondApprove.status, 404);
});

test('an organization without require_bulk_approval keeps the original direct-enqueue behavior', async () => {
  const Organization = require('../models/organization_schema');
  const ORG_DIRECT = 'ORG-BULK-DIRECT';
  await Organization.create({
    organization_code: ORG_DIRECT, name: 'Direct Org', city: 'C', state: 'S', country: 'PY',
    email: 'direct@example.test', phone: '0', status: 'ACTIVE', plan: 'Basic',
  });
  const directToken = jwt.sign({ id: 'd1', username: 'direct_admin', role: 'admin', organization_code: ORG_DIRECT }, process.env.JWT_SECRET, { algorithm: 'HS256' });

  const res = await request(app)
    .post('/api/credentials/bulk-issue')
    .set('Authorization', `Bearer ${directToken}`)
    .send({ recipients: [{ achiever_username: 'erin' }], design_code: 'DESIGN-1', credential_title: 'Test' });

  assert.equal(res.status, 202);
  assert.ok(res.body.batchId, 'must enqueue immediately, no pending_approval_id, when the org opted out');
  assert.equal(res.body.status, undefined);
});

// An approval is not a decision made at the same moment as the request.
// It can land hours or days later, by which time the month's allowance may
// already be spent on other issuance. Approving on the strength of the
// check done at REQUEST time would put the organization over its plan --
// the enqueue is what consumes quota, so the enqueue is what has to be
// guarded.
test('approving a batch after the quota has been spent is refused, and the request stays pending', async () => {
  const Organization = require('../models/organization_schema');
  const Plan = require('../models/plan_schema');
  const Credential = require('../models/credentialSchema');
  const BulkIssuanceApproval = require('../models/bulkIssuanceApproval');
  const crypto = require('crypto');

  const TIGHT_ORG = 'ORG-BULK-TIGHT';
  // Plan names are a fixed enum (models/plan_schema.js), so this reuses
  // the real "Free" tier rather than inventing a name the schema rejects.
  await Plan.create({
    name: 'Free', max_users: 5, max_credentials_per_month: 10,
    max_api_calls_per_month: 100, is_free: true,
  });
  await Organization.create({
    organization_code: TIGHT_ORG, name: 'Tight Co', city: 'C', state: 'S', country: 'PY',
    email: 'tight@example.test', phone: '0', status: 'ACTIVE', plan: 'Free',
    require_bulk_approval: true,
  });
  const tightToken = jwt.sign(
    { id: 'a2', username: 'tight_admin', role: 'admin', organization_code: TIGHT_ORG },
    process.env.JWT_SECRET, { algorithm: 'HS256' },
  );

  // Requested while there is still room for all 8.
  const requested = await request(app)
    .post('/api/credentials/bulk-issue')
    .set('Authorization', `Bearer ${tightToken}`)
    .send({
      recipients: Array.from({ length: 8 }, (_, i) => ({ achiever_username: `tight${i}` })),
      design_code: 'DESIGN-TIGHT',
      credential_title: 'Tight Certificate',
    });
  assert.equal(requested.status, 202);
  assert.equal(requested.body.status, 'pending_approval');

  // Meanwhile the month's allowance gets spent elsewhere: 9 of 10 used.
  await Promise.all(Array.from({ length: 9 }, (_, i) => Credential.create({
    credential_code: `CRED-TIGHT-${i}`,
    credential_title: 'Elsewhere', credential_issue_date: '2026-08-01', credential_expiry_date: '2028-08-01',
    credential_pic_url: 'http://localhost:9000/uploads/x.png',
    achiever_username: `elsewhere${i}`,
    organization_code: TIGHT_ORG, credential_status: 'Issued',
    credential_blockchain_hashes: crypto.createHash('sha256').update(`tight${i}`).digest('hex'),
  })));

  const approved = await request(app)
    .post(`/api/credentials/bulk-issue/${requested.body.pending_approval_id}/approve`)
    .set('Authorization', `Bearer ${tightToken}`)
    .send({});

  assert.equal(approved.status, 402, 'approving must not enqueue a batch the plan can no longer cover');
  assert.equal(approved.body.remaining, 1);
  assert.equal(approved.body.requested, 8);

  // Still pending, not rejected: nothing is wrong with the request, there
  // is just no room this month.
  const stillPending = await BulkIssuanceApproval.findById(requested.body.pending_approval_id).lean();
  assert.equal(stillPending.status, 'pending');
  assert.equal(stillPending.batch_id, undefined, 'nothing may have been enqueued');
});
