const mongoose = require('mongoose');

// Monthly usage counters per organization. Only tracks what can't be
// cheaply and accurately derived from an existing timestamped query —
// credentials-issued-this-month and users-count are computed live from
// Credential.countDocuments()/User.countDocuments() instead (see
// middleware/enforcePlanLimits.js), which is more accurate than a counter
// that can drift out of sync with reality. API calls have no other
// persisted record to count from, so they need an actual counter.
const usageCounterSchema = new mongoose.Schema({
  organization_code: { type: String, required: true, index: true },
  period: { type: String, required: true }, // "YYYY-MM", so it resets naturally each month
  api_calls: { type: Number, default: 0 },
}, { timestamps: true });

usageCounterSchema.index({ organization_code: 1, period: 1 }, { unique: true });

module.exports = mongoose.model('UsageCounter', usageCounterSchema);
