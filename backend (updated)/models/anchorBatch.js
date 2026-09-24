const mongoose = require('mongoose');

// One document per anchoring batch (one per day, typically -- see
// scripts/anchorDailyBatch.js). Deliberately NOT a new field on
// credentialSchema: a credential can be issued once and anchored later, a
// batch spans many credentials across possibly many organizations, and
// keeping this separate means credentialSchema and its existing consumers
// don't change at all.
const anchorBatchSchema = new mongoose.Schema({
  batch_date: { type: String, required: true, unique: true, index: true }, // YYYY-MM-DD, one batch per day
  merkle_root: { type: String, required: true },
  // One entry per credential included in this batch, in the exact order
  // the Merkle tree was built from -- required to regenerate a leaf's
  // proof later (utils/merkleTree.js's getMerkleProof needs the full,
  // ordered leaf list, not just the leaf itself).
  entries: [{
    credential_code: { type: String, required: true },
    leaf_hash: { type: String, required: true },
  }],
  status: { type: String, required: true, enum: ['pending', 'anchored', 'failed'], default: 'pending' },
  chain: { type: String, default: null }, // e.g. "polygon"
  tx_hash: { type: String, default: null },
  anchored_at: { type: Date, default: null },
  failure_reason: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('AnchorBatches', anchorBatchSchema);
