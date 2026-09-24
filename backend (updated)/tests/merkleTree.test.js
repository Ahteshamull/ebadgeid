// tests/merkleTree.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { sha256Hex, getMerkleRoot, getMerkleProof, verifyMerkleProof } = require('../utils/merkleTree');

const leaf = (s) => sha256Hex(s);

test('a single-leaf tree has itself as the root, and an empty proof verifies', () => {
  const leaves = [leaf('CRED-A')];
  const root = getMerkleRoot(leaves);
  assert.equal(root, leaves[0]);
  const proof = getMerkleProof(leaves, 0);
  assert.deepEqual(proof, []);
  assert.equal(verifyMerkleProof(leaves[0], proof, root), true);
});

test('every leaf in an even-sized batch verifies against the same root', () => {
  const leaves = ['CRED-A', 'CRED-B', 'CRED-C', 'CRED-D'].map(leaf);
  const root = getMerkleRoot(leaves);
  for (let i = 0; i < leaves.length; i++) {
    const proof = getMerkleProof(leaves, i);
    assert.equal(verifyMerkleProof(leaves[i], proof, root), true, `leaf ${i} should verify`);
  }
});

test('every leaf in an odd-sized batch verifies against the same root (last-node duplication)', () => {
  const leaves = ['CRED-A', 'CRED-B', 'CRED-C', 'CRED-D', 'CRED-E'].map(leaf);
  const root = getMerkleRoot(leaves);
  for (let i = 0; i < leaves.length; i++) {
    const proof = getMerkleProof(leaves, i);
    assert.equal(verifyMerkleProof(leaves[i], proof, root), true, `leaf ${i} should verify`);
  }
});

test('a batch of one hundred leaves all verify (realistic daily-batch size)', () => {
  const leaves = Array.from({ length: 100 }, (_, i) => leaf(`CRED-${i}`));
  const root = getMerkleRoot(leaves);
  for (let i = 0; i < leaves.length; i += 7) { // sample, not exhaustive, but spread across the tree
    const proof = getMerkleProof(leaves, i);
    assert.equal(verifyMerkleProof(leaves[i], proof, root), true, `leaf ${i} should verify`);
  }
});

test('tampering with the leaf hash breaks verification', () => {
  const leaves = ['CRED-A', 'CRED-B', 'CRED-C'].map(leaf);
  const root = getMerkleRoot(leaves);
  const proof = getMerkleProof(leaves, 1);
  const tamperedLeaf = leaf('CRED-B-TAMPERED');
  assert.equal(verifyMerkleProof(tamperedLeaf, proof, root), false);
});

test('a proof from one batch does not verify against a different batch\'s root', () => {
  const batch1 = ['CRED-A', 'CRED-B', 'CRED-C', 'CRED-D'].map(leaf);
  const batch2 = ['CRED-E', 'CRED-F', 'CRED-G', 'CRED-H'].map(leaf);
  const root1 = getMerkleRoot(batch1);
  const root2 = getMerkleRoot(batch2);
  const proofFromBatch1 = getMerkleProof(batch1, 2);
  assert.equal(verifyMerkleProof(batch1[2], proofFromBatch1, root2), false);
  assert.notEqual(root1, root2);
});

test('the root is deterministic and order-sensitive (same leaves, different order, different root)', () => {
  const leavesA = ['CRED-A', 'CRED-B', 'CRED-C'].map(leaf);
  const leavesB = ['CRED-C', 'CRED-B', 'CRED-A'].map(leaf);
  assert.equal(getMerkleRoot(leavesA), getMerkleRoot(leavesA)); // deterministic
  assert.notEqual(getMerkleRoot(leavesA), getMerkleRoot(leavesB)); // order matters
});

test('getMerkleProof rejects an out-of-range index', () => {
  const leaves = ['CRED-A', 'CRED-B'].map(leaf);
  assert.throws(() => getMerkleProof(leaves, 5), /out of range/);
  assert.throws(() => getMerkleProof(leaves, -1), /out of range/);
});

test('root hashes are real sha256 hex digests (64 hex chars)', () => {
  const leaves = ['CRED-A', 'CRED-B', 'CRED-C'].map(leaf);
  const root = getMerkleRoot(leaves);
  assert.match(root, /^[0-9a-f]{64}$/);
});
