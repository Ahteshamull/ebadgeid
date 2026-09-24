const Redis = require('ioredis');
const logger = require('./logger');

const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { hits, ttl }
`;

let redisClient = null;
let connectPromise = null;
const localWindows = new Map();

function getRedisClient() {
  if (!process.env.REDIS_URL) return null;
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL, {
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => (attempt > 3 ? null : Math.min(attempt * 200, 1000)),
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    redisClient.on('error', (error) => {
      logger.error('rate_limit_redis_error', { message: error.message });
    });
    connectPromise = redisClient.connect().catch((error) => {
      logger.error('rate_limit_redis_connect_failed', { message: error.message });
    });
  }
  return redisClient;
}

// lazyConnect + enableOfflineQueue:false means a command issued before the
// initial connection finishes throws ("Stream isn't writeable") instead of
// queuing — real race found by qa_final_harness.js hitting this module's
// very first command right after the client is constructed. Every caller
// that issues a command must await this instead of calling getRedisClient()
// directly.
async function ensureConnectedClient() {
  const client = getRedisClient();
  if (!client) return null;
  if (client.status !== 'ready' && connectPromise) await connectPromise;
  return client;
}

function localIncrement(key, windowMs) {
  const now = Date.now();
  const existing = localWindows.get(key);
  const current = existing && existing.resetAt > now
    ? existing
    : { hits: 0, resetAt: now + windowMs };
  current.hits += 1;
  localWindows.set(key, current);
  return { totalHits: current.hits, resetTime: new Date(current.resetAt) };
}

async function incrementRedisKey(key, windowMs) {
  const client = await ensureConnectedClient();
  if (!client) throw new Error('REDIS_URL is not configured');
  const [hits, ttl] = await client.eval(INCREMENT_SCRIPT, 1, key, windowMs);
  const safeTtl = Number(ttl) > 0 ? Number(ttl) : windowMs;
  return { totalHits: Number(hits), resetTime: new Date(Date.now() + safeTtl) };
}

class RedisRateLimitStore {
  constructor(prefix) {
    this.prefix = `ebadge:rate:${prefix}:`;
    this.localKeys = false;
    this.windowMs = 60_000;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  increment(key) {
    return incrementRedisKey(`${this.prefix}${key}`, this.windowMs);
  }

  async decrement(key) {
    const client = await ensureConnectedClient();
    if (!client) return;
    const namespacedKey = `${this.prefix}${key}`;
    const current = Number(await client.get(namespacedKey));
    if (current > 0) await client.decr(namespacedKey);
  }

  async resetKey(key) {
    const client = await ensureConnectedClient();
    if (client) await client.del(`${this.prefix}${key}`);
  }
}

function createRateLimitStore(prefix) {
  return process.env.REDIS_URL ? new RedisRateLimitStore(prefix) : undefined;
}

async function consumeRateLimit({ namespace, key, limit, windowMs, failClosed = true }) {
  let result;
  try {
    if (!process.env.REDIS_URL) {
      if (process.env.NODE_ENV === 'production' && failClosed) {
        throw new Error('Distributed rate limiter is unavailable');
      }
      result = localIncrement(`ebadge:rate:${namespace}:${key}`, windowMs);
    } else {
      result = await incrementRedisKey(`ebadge:rate:${namespace}:${key}`, windowMs);
    }
  } catch (error) {
    logger.error('rate_limit_check_failed', { namespace, message: error.message });
    if (failClosed) throw error;
    result = localIncrement(`ebadge:rate:${namespace}:${key}`, windowMs);
  }

  return {
    ...result,
    allowed: result.totalHits <= limit,
    remaining: Math.max(0, limit - result.totalHits),
  };
}

function _setRedisClientForTesting(client) {
  redisClient = client;
  localWindows.clear();
}

module.exports = {
  RedisRateLimitStore,
  createRateLimitStore,
  consumeRateLimit,
  _setRedisClientForTesting,
};
