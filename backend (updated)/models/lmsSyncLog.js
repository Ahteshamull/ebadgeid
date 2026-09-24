// models/lmsSyncLog.js
//
// A real, queryable "sync failed" log -- structured console logs (what
// this codebase already does everywhere via utils/logger.js) are fine
// for an operator with log aggregation, but an org admin has no way to
// browse those. This is what GET /api/lms/sync-log actually reads.
const mongoose = require('mongoose');

const lmsSyncLogSchema = new mongoose.Schema({
  organization_code: { type: String, required: true, index: true },
  started_at: { type: Date, required: true },
  finished_at: { type: Date },
  status: { type: String, required: true, enum: ['success', 'failed'] },
  records_found: { type: Number, default: 0 },
  records_issued: { type: Number, default: 0 },
  records_already_processed: { type: Number, default: 0 },
  records_failed: { type: Number, default: 0 },
  attempts: { type: Number, default: 1 },
  error_message: { type: String },
}, { timestamps: true });

lmsSyncLogSchema.index({ organization_code: 1, createdAt: -1 });

module.exports = mongoose.model('LmsSyncLog', lmsSyncLogSchema);
