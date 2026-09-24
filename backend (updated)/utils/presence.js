// utils/presence.js
//
// "Who else is editing this template right now" -- the scoped-down piece
// of real-time collaboration this backend actually gets: no live cursors
// or operational-transform merging, just short-TTL heartbeats in Redis so
// the editor can show "Ana and Luis are also viewing this template". The
// frontend polls heartbeat()/list() every few seconds; there is no
// WebSocket layer in this backend to push updates instead (see
// AUDIT_FIXES.md for that scope note). Same safe-degradation contract as
// utils/cache.js: no REDIS_URL, or an unreachable Redis, means presence
// silently reports nobody else present rather than breaking the editor.
const Redis = require('ioredis');
const logger = require('./logger');

let client = null;
let connectionFailed = false;

function _setClientForTesting(fakeClient) {
  client = fakeClient;
  connectionFailed = false;
}

function getClient() {
  if (connectionFailed) return null;
  if (client) return client;
  if (!process.env.REDIS_URL) return null;
  client = new Redis(process.env.REDIS_URL, {
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
    lazyConnect: true,
  });
  client.on('error', (err) => logger.error('presence_redis_error', { message: err.message }));
  client.connect().catch((err) => {
    connectionFailed = true;
    logger.error('presence_redis_connect_failed', { message: err.message });
  });
  return client;
}

const PRESENCE_TTL_SECONDS = 20; // frontend heartbeats well inside this window (see design-editor UI)
const keyFor = (designCode, username) => `presence:${designCode}:${username}`;

async function heartbeat(designCode, username) {
  const redis = getClient();
  if (!redis) return false;
  try {
    await redis.set(keyFor(designCode, username), Date.now().toString(), 'EX', PRESENCE_TTL_SECONDS);
    return true;
  } catch (error) {
    logger.error('presence_heartbeat_failed', { message: error.message });
    return false;
  }
}

async function leave(designCode, username) {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.del(keyFor(designCode, username));
  } catch (error) {
    logger.error('presence_leave_failed', { message: error.message });
  }
}

async function listActive(designCode) {
  const redis = getClient();
  if (!redis) return [];
  try {
    const keys = await redis.keys(keyFor(designCode, '*'));
    return keys.map((key) => key.slice(`presence:${designCode}:`.length));
  } catch (error) {
    logger.error('presence_list_failed', { message: error.message });
    return [];
  }
}

async function disconnect() {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
    connectionFailed = false;
  }
}

module.exports = { heartbeat, leave, listActive, disconnect, _setClientForTesting };
