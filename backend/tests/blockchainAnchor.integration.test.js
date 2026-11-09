// tests/blockchainAnchor.integration.test.js
//
// Real integration test (real MongoDB) for the batch-building and
// verification-proof halves of blockchain anchoring — the parts that
// don't require an actual funded wallet or RPC endpoint. Actually writing
// a transaction to a real chain is intentionally NOT exercised here (see
// services/blockchainAnchor.js) — that needs real infrastructure this
// environment doesn't have, and pretending to test it against a mock
// would be exactly the "mock treated as production" anti-pattern this
// project's own validation rounds have been hunting down.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;

function responseDouble() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function issueCredential(orgCode, achieverUsername) {
  const { createCredential } = require('../controllers/credentialController');
  const req = {
    user: { organization_code: orgCode, username: 'admin' },
    body: {
      credential_pic_url: 'http://localhost:9000/uploads/cert.png',
      achiever_username: achieverUsername,
      guest_recipient: { email: `${achieverUsername.toLowerCase()}@example.com`, first_name: achieverUsername, last_name: 'Test' },
    },
  };
  const res = responseDouble();
  await createCredential(req, res);
  assert.equal(res.statusCode, 201);
  return res.body.credential_code;
}

test('isConfigured() is false with no blockchain env vars set (default in this environment)', () => {
  const { isConfigured } = require('../services/blockchainAnchor');
  delete process.env.BLOCKCHAIN_RPC_URL;
  delete process.env.BLOCKCHAIN_PRIVATE_KEY;
  assert.equal(isConfigured(), false);
});

test('anchorBatch() throws a clear, typed error instead of silently pretending to anchor when not configured', async () => {
  const { anchorBatch, buildBatchForDate } = require('../services/blockchainAnchor');
  const Organization = require('../models/organization_schema');
  await Organization.findOneAndUpdate(
    { organization_code: 'ANCHOR-ORG' },
    { organization_code: 'ANCHOR-ORG', name: 'Anchor Org', city: 'C', state: 'S', country: 'Country', email: 'anchor@example.com', phone: '555', status: 'ACTIVE' },
    { upsert: true }
  );
  await issueCredential('ANCHOR-ORG', 'AnchorPerson1');

  const today = new Date().toISOString().split('T')[0];
  await buildBatchForDate(today);

  await assert.rejects(anchorBatch(today), /not configured/);
});

test('buildBatchForDate() with no credentials issued that day returns null (nothing to anchor)', async () => {
  const { buildBatchForDate } = require('../services/blockchainAnchor');
  const batch = await buildBatchForDate('2020-01-01'); // a day with certainly no test data
  assert.equal(batch, null);
});

test('buildBatchForDate() builds a real batch whose root matches the Merkle tree over its own entries', async () => {
  const { buildBatchForDate, leafHashFor } = require('../services/blockchainAnchor');
  const { getMerkleRoot } = require('../utils/merkleTree');
  const Organization = require('../models/organization_schema');
  const Credential = require('../models/credentialSchema');

  await Organization.findOneAndUpdate(
    { organization_code: 'BATCH-ORG' },
    { organization_code: 'BATCH-ORG', name: 'Batch Org', city: 'C', state: 'S', country: 'Country', email: 'batch@example.com', phone: '555', status: 'ACTIVE' },
    { upsert: true }
  );
  const codes = [];
  for (const name of ['Alice', 'Bob', 'Carol']) {
    codes.push(await issueCredential('BATCH-ORG', name));
  }

  const today = new Date().toISOString().split('T')[0];
  const batch = await buildBatchForDate(today);

  assert.ok(batch);
  assert.ok(batch.entries.length >= 3); // may include credentials from the previous test too, same-day
  for (const code of codes) {
    assert.ok(batch.entries.some((e) => e.credential_code === code), `batch should include ${code}`);
  }

  // Recompute the root independently from the batch's own stored entries
  // and confirm it matches what got saved — this is the actual integrity
  // guarantee: anyone can redo this with nothing but the batch document.
  const recomputedRoot = getMerkleRoot(batch.entries.map((e) => e.leaf_hash));
  assert.equal(recomputedRoot, batch.merkle_root);

  // And the leaf hash formula itself is reproducible from public data
  // (credential_code + the already-public integrity hash).
  const cred = await Credential.findOne({ credential_code: codes[0] });
  assert.equal(leafHashFor(cred), batch.entries.find((e) => e.credential_code === codes[0]).leaf_hash);
});

test('getAnchorProofForCredential() returns a proof that verifies against the batch root, for a credential not yet anchored on-chain', async () => {
  const { buildBatchForDate, getAnchorProofForCredential } = require('../services/blockchainAnchor');
  const { verifyMerkleProof } = require('../utils/merkleTree');
  const Organization = require('../models/organization_schema');

  await Organization.findOneAndUpdate(
    { organization_code: 'PROOF-ORG' },
    { organization_code: 'PROOF-ORG', name: 'Proof Org', city: 'C', state: 'S', country: 'Country', email: 'proof@example.com', phone: '555', status: 'ACTIVE' },
    { upsert: true }
  );
  const code = await issueCredential('PROOF-ORG', 'ProofPerson');
  const today = new Date().toISOString().split('T')[0];
  await buildBatchForDate(today);

  const proof = await getAnchorProofForCredential(code);
  assert.ok(proof);
  assert.equal(proof.status, 'pending'); // not anchored on-chain in this environment
  assert.equal(proof.tx_hash, null);
  assert.equal(proof.proof_valid, true);
  assert.equal(verifyMerkleProof(proof.leaf_hash, proof.proof, proof.merkle_root), true);
});

test('getAnchorProofForCredential() returns null for a credential never included in any batch', async () => {
  const { getAnchorProofForCredential } = require('../services/blockchainAnchor');
  const proof = await getAnchorProofForCredential('CRED-NEVER-BATCHED-00000000');
  assert.equal(proof, null);
});

test('GET /api/anchors/verify/:code returns 404 for a credential with no batch', async () => {
  const anchorRoutes = require('../routes/anchorRoutes');
  const express = require('express');
  const request = require('supertest');
  const app = express();
  app.use('/api/anchors', anchorRoutes);

  const res = await request(app).get('/api/anchors/verify/NOT-BATCHED');
  assert.equal(res.status, 404);
});

test('GET /api/anchors/verify/:code returns a working proof for a real batched credential', async () => {
  const { buildBatchForDate } = require('../services/blockchainAnchor');
  const Organization = require('../models/organization_schema');
  const anchorRoutes = require('../routes/anchorRoutes');
  const express = require('express');
  const request = require('supertest');

  await Organization.findOneAndUpdate(
    { organization_code: 'HTTP-PROOF-ORG' },
    { organization_code: 'HTTP-PROOF-ORG', name: 'HTTP Proof Org', city: 'C', state: 'S', country: 'Country', email: 'httpproof@example.com', phone: '555', status: 'ACTIVE' },
    { upsert: true }
  );
  const code = await issueCredential('HTTP-PROOF-ORG', 'HttpProofPerson');
  const today = new Date().toISOString().split('T')[0];
  await buildBatchForDate(today);

  const app = express();
  app.use('/api/anchors', anchorRoutes);
  const res = await request(app).get(`/api/anchors/verify/${code}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.credential_code, code);
  assert.equal(res.body.proof_valid, true);
});
