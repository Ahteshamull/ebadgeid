// middleware/requireApiKey.js
//
// The ApiKey model/CRUD already existed (routes/apiKeyRoutes.js), with a
// requests_allowed_per_minute field — but nothing anywhere actually
// validated an incoming request against it. An organization could
// generate a key and it would do nothing. This is the missing piece: a
// middleware that checks the X-API-Key header, verifies the key is
// Active and not past its valid_for window, sets req.user.organization_code.
// so downstream org-scoping (requireOwnOrg) still works unchanged, and
// enforces that key's own per-minute budget through the shared Redis
// limiter, so restarts and horizontal scaling cannot reset or multiply it.
const ApiKey = require('../models/api_keys');
const logger = require('../utils/logger');
const { trackAndCheckApiUsage } = require('./enforcePlanLimits');
const crypto = require('crypto');
const { consumeRateLimit } = require('../utils/distributedRateLimit');

const hashApiKey = (value) => crypto.createHash('sha256').update(value).digest('hex');

const requireApiKey = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ message: 'X-API-Key header required' });
  }

  try {
    const apiKeyHash = hashApiKey(apiKey);
    const record = await ApiKey.findOne({
      $or: [{ api_key_hash: apiKeyHash }, { api_key: apiKey }],
    }).select('+api_key +api_key_hash');
    if (!record) {
      return res.status(403).json({ message: 'Invalid API key' });
    }

    // One-way migration for records created before hashed storage existed.
    if (!record.api_key_hash) {
      record.api_key_hash = apiKeyHash;
      record.api_key = undefined;
    }
    if (record.status !== 'Active') {
      return res.status(403).json({ message: `API key is ${record.status.toLowerCase()}` });
    }
    const expiresAt = new Date(record.createdAt);
    expiresAt.setDate(expiresAt.getDate() + record.valid_for);
    if (expiresAt < new Date()) {
      record.status = 'Expired';
      await record.save();
      return res.status(403).json({ message: 'API key has expired' });
    }

    const rate = await consumeRateLimit({
      namespace: 'api-key',
      key: apiKeyHash,
      limit: record.requests_allowed_per_minute,
      windowMs: 60 * 1000,
      failClosed: true,
    });
    res.set?.('RateLimit-Limit', String(record.requests_allowed_per_minute));
    res.set?.('RateLimit-Remaining', String(rate.remaining));
    res.set?.('RateLimit-Reset', String(Math.ceil(rate.resetTime.getTime() / 1000)));
    if (!rate.allowed) {
      logger.warn('api_key_rate_limited', { organization_code: record.organization_code });
      return res.status(429).json({ message: 'Rate limit exceeded for this API key' });
    }

    record.last_used_at = new Date();
    await record.save();

    // Normalized to look like requireAuth's req.user so downstream
    // middleware (requireOwnOrg) and controllers work unchanged regardless
    // of whether the caller authenticated with a user JWT or an API key.
    req.user = { organization_code: record.organization_code, role: 'admin', via: 'api_key' };

    // This is what "API calls" actually means as a plan limit dimension —
    // every request authenticated via an API key counts against the
    // organization's monthly quota, separate from the per-key
    // requests-per-minute burst limit above.
    return trackAndCheckApiUsage(req, res, next);
  } catch (err) {
    logger.error('api_key_check_failed', { message: err.message });
    const unavailable = /rate limiter|REDIS_URL|Redis/i.test(err.message);
    res.status(unavailable ? 503 : 500).json({
      message: unavailable ? 'API key validation temporarily unavailable' : 'Server error validating API key',
    });
  }
};

module.exports = { requireApiKey, hashApiKey };
