// utils/merkleTree.js
//
// Standard binary Merkle tree over SHA-256 leaf hashes -- the piece that
// makes blockchain anchoring affordable: instead of writing one
// transaction per credential (expensive, and pointless for a service that
// issues far more credentials per day than anyone will ever verify),
// every credential issued in a batch (a day, typically) becomes one leaf.
// Only the single root hash gets anchored on-chain (see
// services/blockchainAnchor.js); anyone holding one credential's leaf hash
// plus its proof path can verify it belongs to that root without needing
// the other credentials in the batch at all.
//
// Odd node counts are handled by duplicating the last node of a level
// (the same convention Bitcoin's own Merkle trees use) -- simpler than
// promoting an unpaired node, and just as sound since both sides of the
// tree are always full SHA-256(left+right) hashes.
const crypto = require('crypto');

const sha256Hex = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Combines two leaf/node hashes into their parent. Sorted so that
// hashPair(a, b) === hashPair(b, a) -- proof verification shouldn't have
// to remember which side a sibling was on, only what it was.
const hashPair = (a, b) => {
  const [first, second] = [a, b].sort();
  return sha256Hex(first + second);
};

// Builds every level of the tree from the leaves up. Returns the full
// list of levels (leaves first, root last) so callers can both read the
// root and derive a proof for any leaf without recomputing anything.
function buildMerkleLevels(leafHashes) {
  if (!Array.isArray(leafHashes) || leafHashes.length === 0) {
    throw new Error('buildMerkleLevels requires at least one leaf hash');
  }
  const levels = [leafHashes.slice()];
  let current = leafHashes;
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = i + 1 < current.length ? current[i + 1] : current[i]; // duplicate last if odd
      next.push(hashPair(left, right));
    }
    levels.push(next);
    current = next;
  }
  return levels;
}

function getMerkleRoot(leafHashes) {
  const levels = buildMerkleLevels(leafHashes);
  return levels[levels.length - 1][0];
}

// Returns the sibling hash at each level needed to recompute the root from
// a single leaf -- what actually gets handed to a third-party verifier,
// not the whole batch.
function getMerkleProof(leafHashes, leafIndex) {
  if (leafIndex < 0 || leafIndex >= leafHashes.length) {
    throw new Error('leafIndex out of range');
  }
  const levels = buildMerkleLevels(leafHashes);
  const proof = [];
  let index = leafIndex;
  for (let level = 0; level < levels.length - 1; level++) {
    const nodes = levels[level];
    const isRightNode = index % 2 === 1;
    const siblingIndex = isRightNode ? index - 1 : index + 1;
    const sibling = siblingIndex < nodes.length ? nodes[siblingIndex] : nodes[index]; // odd-level duplicate
    proof.push(sibling);
    index = Math.floor(index / 2);
  }
  return proof;
}

// Recomputes the root from a leaf hash and its proof path -- this is the
// entire verification: no database, no network call, just hashing. A
// verifier only needs this function, the leaf hash, the proof array, and
// the root that was actually anchored on-chain.
function verifyMerkleProof(leafHash, proof, expectedRoot) {
  let computed = leafHash;
  for (const sibling of proof) {
    computed = hashPair(computed, sibling);
  }
  return computed === expectedRoot;
}

module.exports = { sha256Hex, hashPair, buildMerkleLevels, getMerkleRoot, getMerkleProof, verifyMerkleProof };
