// services/blockchainAnchor.js
//
// The standard "cheap blockchain anchoring" pattern (the same one POK/
// Acreditta use, not a custom scheme): hash every credential issued in a
// batch, build a Merkle tree over those hashes (utils/merkleTree.js), and
// write only the single root on-chain -- one transaction anchors an
// entire day's worth of credentials instead of one transaction each.
// Verifying one credential later needs its leaf hash, its Merkle proof
// (both cheap to recompute from this batch's `entries`), and the root
// that's actually on-chain -- no new transaction, no per-verification
// cost.
//
// Degrades explicitly, same convention as queues/bulkIssuanceQueue.js:
// if the chain isn't configured, building and storing a batch still
// works (so `entries`/`merkle_root` exist and are independently
// verifiable even before anything is anchored), but actually writing to
// chain throws a clear, typed error instead of silently pretending to
// have anchored anything. No real chain write happens anywhere in this
// codebase's test suite -- that would require an actual funded wallet,
// which isn't something to fabricate here.
const crypto = require('crypto');
const AnchorBatch = require('../models/anchorBatch');
const Credential = require('../models/credentialSchema');
const { getMerkleRoot, getMerkleProof, verifyMerkleProof } = require('../utils/merkleTree');

const leafHashFor = (credential) =>
  crypto.createHash('sha256').update(`${credential.credential_code}|${credential.credential_blockchain_hashes}`).digest('hex');

function isConfigured() {
  return Boolean(process.env.BLOCKCHAIN_RPC_URL && process.env.BLOCKCHAIN_PRIVATE_KEY);
}

// Builds (or rebuilds, if run again before anchoring) the batch for a
// given day from whatever credentials were issued that day --
// credential_issue_date is already stored as YYYY-MM-DD (see
// credentialController.js formatDate), so this is a direct field match,
// not a date-range query.
async function buildBatchForDate(batchDate) {
  const credentials = await Credential.find({ credential_issue_date: batchDate })
    .select('credential_code credential_blockchain_hashes')
    .sort({ credential_code: 1 }) // stable order -- the same batch always builds the same tree
    .lean();

  if (credentials.length === 0) {
    return null; // nothing issued that day; nothing to anchor
  }

  const entries = credentials.map((c) => ({
    credential_code: c.credential_code,
    leaf_hash: leafHashFor(c),
  }));
  const merkle_root = getMerkleRoot(entries.map((e) => e.leaf_hash));

  const batch = await AnchorBatch.findOneAndUpdate(
    { batch_date: batchDate, status: 'pending' }, // only ever rebuild a batch that hasn't anchored yet
    { batch_date: batchDate, merkle_root, entries },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return batch;
}

// Writes only the Merkle root on-chain, as the `data` payload of a
// zero-value self-transaction -- a well-known lightweight anchoring
// pattern (no contract to deploy, own, or upgrade; the transaction's own
// existence at a specific block IS the timestamp proof). Requires a real
// funded wallet (BLOCKCHAIN_PRIVATE_KEY) and RPC endpoint
// (BLOCKCHAIN_RPC_URL, e.g. a Polygon RPC) -- operator setup, not
// something this code can supply.
async function anchorBatch(batchDate) {
  if (!isConfigured()) {
    throw new Error('Blockchain anchoring is not configured (BLOCKCHAIN_RPC_URL / BLOCKCHAIN_PRIVATE_KEY are not set)');
  }
  const batch = await AnchorBatch.findOne({ batch_date: batchDate });
  if (!batch) throw new Error(`No batch found for ${batchDate} -- call buildBatchForDate first`);
  if (batch.status === 'anchored') return batch; // already done, idempotent

  const { ethers } = require('ethers');
  const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
  const wallet = new ethers.Wallet(process.env.BLOCKCHAIN_PRIVATE_KEY, provider);

  try {
    const tx = await wallet.sendTransaction({
      to: process.env.BLOCKCHAIN_ANCHOR_ADDRESS || wallet.address, // defaults to a self-transaction
      value: 0,
      data: `0x${batch.merkle_root}`,
    });
    await tx.wait();
    batch.status = 'anchored';
    batch.chain = process.env.BLOCKCHAIN_CHAIN_NAME || 'polygon';
    batch.tx_hash = tx.hash;
    batch.anchored_at = new Date();
    await batch.save();
    return batch;
  } catch (error) {
    batch.status = 'failed';
    batch.failure_reason = error.message;
    await batch.save();
    throw error;
  }
}

// Public verification path: given a credential_code, find the batch it
// was included in and return everything a third party needs to verify it
// independently (leaf hash, proof, root, and the on-chain transaction if
// it's been anchored) -- no database trust required on their end, only
// arithmetic (utils/merkleTree.js:verifyMerkleProof) plus, once anchored,
// looking the transaction up on a block explorer themselves.
async function getAnchorProofForCredential(credentialCode) {
  const batch = await AnchorBatch.findOne({ 'entries.credential_code': credentialCode });
  if (!batch) return null;

  const orderedHashes = batch.entries.map((e) => e.leaf_hash);
  const index = batch.entries.findIndex((e) => e.credential_code === credentialCode);
  const leaf_hash = batch.entries[index].leaf_hash;
  const proof = getMerkleProof(orderedHashes, index);
  const proof_valid = verifyMerkleProof(leaf_hash, proof, batch.merkle_root);

  return {
    credential_code: credentialCode,
    leaf_hash,
    proof,
    merkle_root: batch.merkle_root,
    proof_valid,
    batch_date: batch.batch_date,
    status: batch.status,
    chain: batch.chain,
    tx_hash: batch.tx_hash,
    anchored_at: batch.anchored_at,
  };
}

module.exports = { isConfigured, buildBatchForDate, anchorBatch, getAnchorProofForCredential, leafHashFor };
