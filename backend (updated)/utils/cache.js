// utils/cache.js
//
// Cache-aside layer for the public credential verification endpoint —
// the highest-traffic, least-controlled endpoint in the system (anyone
// with a credential code can hit it, no auth). Written and syntax/logic
// verified in this environment, but NOT verified against a real Redis
// instance (none is available here) — see AUDIT_FIXES.md / README.md for
// that limitation stated plainly. Designed to degrade safely either way:
// if REDIS_URL isn't set, or Redis is unreachable, every operation is a
// no-op that falls through to the database — a missing/broken cache must
// never be why credential verification stops working.
const Redis = require('ioredis');
const logger = require('./logger');

let client = null;
let connectionFailed = false;

// Test-only injection point. Production code never calls this — the real
// path always goes through getClient()'s normal ioredis construction
// below. Exists so utils/cache.js can be tested against a real
// implementation of the get/set/del contract without needing a live
// Redis server (not available in this environment — see README.md). Kept
// as an explicit, clearly-named escape hatch rather than reaching into
// Node's module cache or monkey-patching `ioredis` itself, which would
// be far more fragile and much less obvious to the next person reading
// this file.
function _setClientForTesting(fakeClient) {
  client = fakeClient;
  connectionFailed = false;
}

function getClient() {
  if (connectionFailed) return null;
  if (client) return client; // already set (real, or injected for a test)
  if (!process.env.REDIS_URL) return null; // caching is opt-in, not required
  {
    client = new Redis(process.env.REDIS_URL, {
      // Don't let a slow/unreachable Redis hold up a request — this cache
      // is a pure optimization, not a dependency the request should wait
      // on. Retries are capped so a dead Redis doesn't retry forever in
      // the background either.
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
      lazyConnect: true,
    });
    client.on('error', (err) => {
      logger.error('redis_error', { message: err.message });
    });
    client.connect().catch((err) => {
      connectionFailed = true;
      logger.error('redis_connect_failed', { message: err.message });
    });
  }
  return client;
}

const DEFAULT_TTL_SECONDS = 60; // short TTL: a revoked credential should stop showing as valid quickly

async function getCached(key) {
  const redis = getClient();
  if (!redis) return null;
  try {
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logger.error('redis_get_failed', { key, message: error.message });
    return null; // cache miss on any failure — fall through to the DB
  }
}

async function setCached(key, value, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (error) {
    logger.error('redis_set_failed', { key, message: error.message });
    // best-effort — a failed cache write should never fail the request
  }
}

async function invalidate(key) {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch (error) {
    logger.error('redis_del_failed', { key, message: error.message });
  }
}

// HIGH-01 fix (audit finding, confirmed by code review): getCached/setCached
// above are a check-then-act pair by design (cache-aside for the public
// credential endpoint, where a miss just means "ask the database instead")
// -- correct there, but services/samlAuth.js's replay-protection reused the
// same pair for a security check, which has two real problems: (1) two
// concurrent requests can both see a miss before either writes, so the same
// captured, validly-signed SAMLResponse can be accepted twice; (2) getCached
// fails OPEN (returns null) on any Redis error, so a degraded/unreachable
// Redis silently disables replay protection entirely instead of blocking
// logins. Real, security-sensitive "has this been used before" checks need
// their own atomic primitives that fail CLOSED, not the cache-aside pair.
//
// reserveOnce: a single atomic SET ... NX EX -- Redis itself guarantees only
// one caller can ever win this for a given key, closing the race completely
// (no separate read then write). Throws (does not return a "safe" default)
// if Redis isn't configured or the command itself fails, so a caller doing
// security-critical replay protection can turn that into a hard rejection
// instead of silently proceeding as if the key were new.
async function reserveOnce(key, ttlSeconds) {
  const redis = getClient();
  if (!redis) throw new Error('Redis is not available for an atomic reservation');
  const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK'; // true = this call actually reserved it (first use); false = already reserved (replay)
}

// consumeOnce: atomic GETDEL -- reading and deleting in one round trip is
// what makes "was this outstanding request real, and has it now been used"
// race-free; a separate GET then DEL (the previous getCached/invalidate
// pair) leaves the same window reserveOnce closes above. Same fail-closed
// contract: throws rather than returning null on a Redis failure, so it can
// never be silently mistaken for "key never existed."
async function consumeOnce(key) {
  const redis = getClient();
  if (!redis) throw new Error('Redis is not available for an atomic consume');
  return redis.call('GETDEL', key);
}

module.exports = { getCached, setCached, invalidate, reserveOnce, consumeOnce, _setClientForTesting };
