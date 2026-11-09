// models/bulkIssuanceApproval.js
//
// A pending bulk-issuance request, held for review before any credential
// actually gets enqueued -- only created when the requesting organization
// has organization_schema.js's require_bulk_approval set. Approving one
// (routes/credential_routes.js) is what actually calls
// queues/bulkIssuanceQueue.js's enqueueBulkIssuance -- nothing gets
// issued from a request sitting in 'pending'.
const mongoose = require('mongoose');

const bulkIssuanceApprovalSchema = new mongoose.Schema({
  organization_code: { type: String, required: true, index: true },
  recipients: { type: Array, required: true },
  design_code: { type: String },
  credential_title: { type: String },
  requested_by: { type: String, required: true },
  status: { type: String, required: true, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  reviewed_by: { type: String },
  reviewed_at: { type: Date },
  rejection_reason: { type: String },
  // Set once approval actually enqueues the real batch, so the approval
  // record and the resulting bulk-issuance job status stay linkable.
  batch_id: { type: String },
}, { timestamps: true });

bulkIssuanceApprovalSchema.index({ organization_code: 1, status: 1 });

module.exports = mongoose.model('BulkIssuanceApproval', bulkIssuanceApprovalSchema);
