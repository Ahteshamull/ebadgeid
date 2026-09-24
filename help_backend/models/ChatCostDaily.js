const mongoose = require('mongoose');

// Daily tenant aggregate used for budget monitoring. It is intentionally
// separate from session detail so alerting does not require scanning every
// active or historical chat session on each AI response.
const chatCostDailySchema = new mongoose.Schema({
  organization_code: { type: String, required: true, trim: true },
  day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  total_cost: { type: Number, required: true, default: 0, min: 0 },
  request_count: { type: Number, required: true, default: 0, min: 0 },
  alert_sent_at: { type: Date, default: null },
  expires_at: { type: Date, required: true },
}, { timestamps: true, collection: 'chat_cost_daily' });

chatCostDailySchema.index({ organization_code: 1, day: 1 }, { unique: true, name: 'org_daily_cost_unique' });
chatCostDailySchema.index({ expires_at: 1 }, { expireAfterSeconds: 0, name: 'chat_cost_daily_retention_ttl' });

module.exports = mongoose.model('ChatCostDaily', chatCostDailySchema);
