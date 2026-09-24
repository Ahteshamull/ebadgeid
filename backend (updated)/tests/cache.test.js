// tests/cache.test.js
//
// Tests utils/cache.js's actual get/set/del logic — not just "does it
// skip cleanly when Redis is unavailable" (already covered live in
// AUDIT_FIXES.md), but the cache-aside behavior itself: does a cached
// value round-trip correctly, does TTL expiry actually work, does
// invalidate() actually remove a key. A real Redis server isn't
// available in this environment (mongodb-memory-server's MongoDB
// download and a real Redis TCP connection both require network access
// this sandbox doesn't have — see README.md for that limitation stated
// plainly, not hidden). This uses a small, purpose-built fake that
// implements exactly the three operations cache.js actually calls
// (get/set with EX/del) with real expiry semantics, injected via
// cache.js's _setClientForTesting — not a general-purpose Redis mock
// with its own unrelated version constraints.
const test = require('node:test');
const assert = require('node:assert/strict');

// A minimal, correct fake of the three ioredis operations utils/cache.js
// actually uses. TTL is tracked with real wall-clock expiry so the "TTL
// expiry" test below is testing real time-based behavior, not a stub
// that always returns the same thing.
function createFakeRedisClient() {
  const store = new Map(); // key -> { value, expiresAt }
  return {
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
        store.delete(key); // real Redis also evicts lazily on read past TTL
        return null;
      }
      return entry.value;
    },
    async set(key, value, mode, ttlSeconds) {
      const expiresAt = mode === 'EX' ? Date.now() + ttlSeconds * 1000 : null;
      store.set(key, { value, expiresAt });
      return 'OK';
    },
    async del(key) {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    },
    // test-only helper, not part of the real ioredis interface
    _size() {
      return store.size;
    },
  };
}

test('setCached then getCached round-trips the same value', async () => {
  const cache = require('../utils/cache');
  cache._setClientForTesting(createFakeRedisClient());

  await cache.setCached('credential:CRED-1', { credential_code: 'CRED-1', integrity_valid: true });
  const result = await cache.getCached('credential:CRED-1');

  assert.deepEqual(result, { credential_code: 'CRED-1', integrity_valid: true });
});

test('getCached returns null for a key that was never set', async () => {
  const cache = require('../utils/cache');
  cache._setClientForTesting(createFakeRedisClient());

  const result = await cache.getCached('credential:NEVER-SET');
  assert.equal(result, null);
});

test('invalidate actually removes a cached value — this is what keeps a just-revoked credential from still showing as valid', async () => {
  const cache = require('../utils/cache');
  const fakeClient = createFakeRedisClient();
  cache._setClientForTesting(fakeClient);

  await cache.setCached('credential:CRED-2', { credential_status: 'Issued' });
  assert.notEqual(await cache.getCached('credential:CRED-2'), null, 'sanity check: it was actually cached');

  await cache.invalidate('credential:CRED-2');

  assert.equal(await cache.getCached('credential:CRED-2'), null, 'value must be gone after invalidate()');
  assert.equal(fakeClient._size(), 0);
});

test('a cached value expires after its TTL and getCached falls back to a miss (null)', async () => {
  const cache = require('../utils/cache');
  cache._setClientForTesting(createFakeRedisClient());

  // 1-second TTL instead of the real 60s default — this test verifies
  // the expiry mechanism itself works, not that it takes exactly 60s.
  await cache.setCached('credential:CRED-3', { credential_code: 'CRED-3' }, 1);
  assert.notEqual(await cache.getCached('credential:CRED-3'), null, 'should still be cached immediately after setting');

  await new Promise((resolve) => setTimeout(resolve, 1100));

  assert.equal(await cache.getCached('credential:CRED-3'), null, 'must be gone once its TTL has passed');
});

test('setCached called twice for the same key overwrites the previous value (not a merge, not a duplicate)', async () => {
  const cache = require('../utils/cache');
  const fakeClient = createFakeRedisClient();
  cache._setClientForTesting(fakeClient);

  await cache.setCached('credential:CRED-4', { credential_status: 'Issued' });
  await cache.setCached('credential:CRED-4', { credential_status: 'Revoked' });

  const result = await cache.getCached('credential:CRED-4');
  assert.deepEqual(result, { credential_status: 'Revoked' });
  assert.equal(fakeClient._size(), 1, 'must not have left a stale duplicate entry behind');
});
