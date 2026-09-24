const mongoose = require('mongoose');

const rateLimitCounterSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  totalHits: { type: Number, required: true, default: 0 },
  resetTime: { type: Date, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
}, { versionKey: false });

module.exports = mongoose.models.RateLimitCounter
  || mongoose.model('RateLimitCounter', rateLimitCounterSchema);
