const mongoose = require('mongoose');

// One document per tenant/session. This makes analytics survive a process
// restart and, unlike the old in-memory Map alone, keeps each tenant's data
// queryable without scanning another tenant's sessions.
const chatCostSchema = new mongoose.Schema({
  organization_code: { type: String, required: true, trim: true, index: true },
  session_id: { type: String, required: true, trim: true },
  total_input_cost: { type: Number, required: true, default: 0, min: 0 },
  total_output_cost: { type: Number, required: true, default: 0, min: 0 },
  total_cost: { type: Number, required: true, default: 0, min: 0 },
  request_count: { type: Number, required: true, default: 0, min: 0 },
  last_activity_at: { type: Date, required: true, default: Date.now },
  // TTL is an explicit retention policy. The default is intentionally
  // configurable so regulated tenants can choose an approved duration.
  expires_at: { type: Date, required: true },
}, { timestamps: true, collection: 'chat_costs' });

chatCostSchema.index({ organization_code: 1, session_id: 1 }, { unique: true, name: 'org_session_cost_unique' });
chatCostSchema.index({ organization_code: 1, last_activity_at: -1 }, { name: 'org_cost_recent' });
chatCostSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0, name: 'chat_cost_retention_ttl' });

module.exports = mongoose.model('ChatCost', chatCostSchema);
