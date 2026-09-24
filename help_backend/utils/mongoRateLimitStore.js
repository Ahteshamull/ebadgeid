const RateLimitCounter = require('../models/rateLimitCounter');

class MongoRateLimitStore {
  constructor(prefix) {
    this.prefix = `helpdesk:${prefix}:`;
    this.windowMs = 60_000;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const now = new Date();
    const nextReset = new Date(now.getTime() + this.windowMs);
    const fullKey = `${this.prefix}${key}`;
    const isCurrentWindow = {
      $gt: [{ $ifNull: ['$resetTime', new Date(0)] }, now],
    };
    const counter = await RateLimitCounter.findOneAndUpdate(
      { key: fullKey },
      [{
        $set: {
          key: fullKey,
          totalHits: {
            $cond: [
              isCurrentWindow,
              { $add: [{ $ifNull: ['$totalHits', 0] }, 1] },
              1,
            ],
          },
          resetTime: { $cond: [isCurrentWindow, '$resetTime', nextReset] },
          expiresAt: { $cond: [isCurrentWindow, '$resetTime', nextReset] },
        },
      }],
      { upsert: true, new: true }
    ).lean();
    return { totalHits: counter.totalHits, resetTime: counter.resetTime };
  }

  async decrement(key) {
    await RateLimitCounter.updateOne(
      { key: `${this.prefix}${key}`, totalHits: { $gt: 0 } },
      { $inc: { totalHits: -1 } }
    );
  }

  async resetKey(key) {
    await RateLimitCounter.deleteOne({ key: `${this.prefix}${key}` });
  }
}

module.exports = { MongoRateLimitStore };
