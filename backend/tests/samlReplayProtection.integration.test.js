// tests/samlReplayProtection.integration.test.js
//
// SEC-AUDIT-3 (deep technical & security audit): samlify extracts a login
// response's InResponseTo but never validates it against anything this SP
// actually issued (confirmed by reading samlify's real source and by
// running a real signed assertion through it -- see services/samlAuth.js's
// header comment on OUTSTANDING_REQUEST_TTL_SECONDS for the full trail).
// Without a fix, a captured, validly-signed SAMLResponse could be POSTed to
// the ACS a second time and accepted as a brand-new login. This test proves
// the fix with a real replay attempt, not just by reading the new code: a
// real SP-initiated login request, a real signed response from a real
// self-signed IdP, POSTed to the ACS once (must succeed) and then POSTed
// again unchanged (must be rejected).
//
// Uses the same fake-Redis-client injection point (utils/cache.js's
// _setClientForTesting) that tests/cache.test.js already established, since
// a real Redis server isn't reachable in the standard `npm test` run (see
// README.md) -- this exercises the real get/set/del contract the fix
// depends on, not a stub that always returns the same thing.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const samlify = require('samlify');
const selfsigned = require('selfsigned');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';
// Never actually dialed -- utils/cache.js's _setClientForTesting below
// injects a fake client before any real connection would be attempted.
// Only needs to be truthy: services/samlAuth.js gates the replay check on
// process.env.REDIS_URL being set, same opt-in convention the rest of the
// codebase already uses for Redis-backed features.
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://fake-for-test:6379';

function createFakeRedisClient() {
  const store = new Map();
  function isLive(entry) {
    return Boolean(entry) && (entry.expiresAt === null || Date.now() <= entry.expiresAt);
  }
  return {
    async get(key) {
      const entry = store.get(key);
      if (!isLive(entry)) { store.delete(key); return null; }
      return entry.value;
    },
    // Mirrors ioredis's set(key, value, 'EX', ttlSeconds[, 'NX']) shape --
    // utils/cache.js's reserveOnce (HIGH-01 fix) relies on real NX
    // semantics: refuse to overwrite a still-live key, atomically.
    async set(key, value, mode, ttlSeconds, nx) {
      if (nx === 'NX' && isLive(store.get(key))) return null;
      const expiresAt = mode === 'EX' ? Date.now() + ttlSeconds * 1000 : null;
      store.set(key, { value, expiresAt });
      return 'OK';
    },
    // utils/cache.js's consumeOnce (HIGH-01 fix) issues a real GETDEL.
    async call(command, key) {
      if (String(command).toUpperCase() === 'GETDEL') {
        const entry = store.get(key);
        store.delete(key);
        return isLive(entry) ? entry.value : null;
      }
      throw new Error(`fake redis client: unsupported command ${command}`);
    },
    async del(key) {
      const existed = isLive(store.get(key));
      store.delete(key);
      return existed ? 1 : 0;
    },
  };
}

// Fakes just enough of ioredis's surface for utils/distributedRateLimit.js's
// RedisRateLimitStore (INCR+PEXPIRE via a Lua eval, plus get/decr/del) --
// see the comment on _setRedisClientForTesting in test.before below for why
// this exists: this file, like tests/samlSso.integration.test.js, sets a
// fake REDIS_URL, which uniquely (among this whole test suite) makes the
// /acs route's rate limiter attempt a real network connection unless mocked.
function createFakeRateLimitRedisClient() {
  const store = new Map();
  return {
    status: 'ready',
    async eval(_script, _numKeys, key, windowMs) {
      const hits = (store.get(key) || 0) + 1;
      store.set(key, hits);
      return [hits, Number(windowMs)];
    },
    async get(key) {
      return store.has(key) ? String(store.get(key)) : null;
    },
    async decr(key) {
      const next = Math.max(0, (store.get(key) || 0) - 1);
      store.set(key, next);
      return next;
    },
    async del(key) {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    },
  };
}

let mongod;
let app;
const ORG = 'ORG-SAML-REPLAY';
let fakeIdpCert;
let fakeIdpKey;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));

  const { _setClientForTesting } = require('../utils/cache');
  _setClientForTesting(createFakeRedisClient());

  // See createFakeRateLimitRedisClient's comment above -- this route runs
  // behind samlAuthLimiter, a rate limiter with its own, separate Redis
  // client (utils/distributedRateLimit.js) that needs its own mock.
  const { _setRedisClientForTesting } = require('../utils/distributedRateLimit');
  _setRedisClientForTesting(createFakeRateLimitRedisClient());

  const adminToken = jwt.sign({ id: 's1', username: 'saml_replay_admin', role: 'admin', organization_code: ORG }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  const Organization = require('../models/organization_schema');
  await Organization.create({
    organization_code: ORG, name: 'SAML Replay Org', city: 'C', state: 'S', country: 'PY',
    email: 'samlreplay@example.test', phone: '0', status: 'ACTIVE', plan: 'Enterprise',
  });

  const pems = await selfsigned.generate([{ name: 'commonName', value: 'replay-idp.example.test' }], { keySize: 2048, days: 365, algorithm: 'sha256' });
  fakeIdpCert = pems.cert;
  fakeIdpKey = pems.private;

  await request(app)
    .put('/api/auth/saml/config')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      idp_entity_id: 'https://replay-idp.example.test/entity',
      idp_sso_url: 'https://replay-idp.example.test/sso',
      idp_certificate: fakeIdpCert,
    });
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

function buildRealIdp() {
  return samlify.IdentityProvider({
    entityID: 'https://replay-idp.example.test/entity',
    privateKey: fakeIdpKey,
    signingCert: fakeIdpCert,
    singleSignOnService: [{ Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect', Location: 'https://replay-idp.example.test/sso' }],
  });
}

test('a real SP-initiated login still succeeds with replay protection active (Redis configured)', async () => {
  const { buildServiceProvider } = require('../services/samlAuth');
  const sp = buildServiceProvider(ORG);
  const idp = buildRealIdp();

  // A real SP-initiated login redirect first, exactly what GET /login
  // produces (the encoded SAMLRequest doesn't expose the plain request id
  // this test needs, so a parallel request against the same real SP config
  // is built below to capture it directly).
  const loginRes = await request(app).get(`/api/auth/saml/${ORG}/login`);
  assert.equal(loginRes.status, 302);

  // Build a response tied to a request this test creates directly against
  // the same real SP config -- equivalent to what /login just issued
  // (same organization, same SP), and lets this test capture the request
  // id needed to construct a valid, schema-correct InResponseTo.
  const { id: freshRequestId } = sp.createLoginRequest(idp, 'redirect');
  // The real endpoint doesn't expose its internally-generated request id,
  // so this test also records this specific id as outstanding the same way
  // buildLoginRedirect() does, to prove the full accept-then-reject-replay
  // cycle end to end against the real ACS route.
  const { setCached } = require('../utils/cache');
  await setCached(`saml:outstanding-request:${ORG}:${freshRequestId}`, true, 900);

  const { context: samlResponseXml } = await idp.createLoginResponse(sp, { extract: { request: { id: freshRequestId } } }, 'post', { email: 'replay.user@customer-enterprise.test' });

  const firstAttempt = await request(app)
    .post(`/api/auth/saml/${ORG}/acs`)
    .type('form')
    .send({ SAMLResponse: samlResponseXml });

  assert.equal(firstAttempt.status, 302, `expected the first, legitimate use to succeed, got ${firstAttempt.status}: ${JSON.stringify(firstAttempt.body)}`);
  assert.match(firstAttempt.headers.location, /sso=success/);

  // The real point of this test: replaying the exact same, still validly-
  // signed, still-within-its-time-window response a second time.
  const replayAttempt = await request(app)
    .post(`/api/auth/saml/${ORG}/acs`)
    .type('form')
    .send({ SAMLResponse: samlResponseXml });

  assert.equal(replayAttempt.status, 400, `expected the replay to be rejected, got ${replayAttempt.status}: ${JSON.stringify(replayAttempt.body)}`);
  assert.match(replayAttempt.body.message, /already used|expired|not issued/i);
});

test('a genuinely fresh login after a rejected replay still succeeds (the mechanism only blocks the reused response, not the organization)', async () => {
  const { buildServiceProvider } = require('../services/samlAuth');
  const sp = buildServiceProvider(ORG);
  const idp = buildRealIdp();

  const { id: requestId } = sp.createLoginRequest(idp, 'redirect');
  const { setCached } = require('../utils/cache');
  await setCached(`saml:outstanding-request:${ORG}:${requestId}`, true, 900);

  const { context: samlResponseXml } = await idp.createLoginResponse(sp, { extract: { request: { id: requestId } } }, 'post', { email: 'fresh.after.replay@customer-enterprise.test' });

  const res = await request(app)
    .post(`/api/auth/saml/${ORG}/acs`)
    .type('form')
    .send({ SAMLResponse: samlResponseXml });

  assert.equal(res.status, 302, JSON.stringify(res.body));
  assert.match(res.headers.location, /sso=success/);
});

test('a response whose InResponseTo was never issued by this SP is rejected outright', async () => {
  const { buildServiceProvider } = require('../services/samlAuth');
  const sp = buildServiceProvider(ORG);
  const idp = buildRealIdp();

  // A request id this test never records as outstanding -- simulates a
  // forged or already-expired/already-consumed InResponseTo.
  const neverIssuedRequestId = '_never-issued-by-this-sp-0000000000000000';
  const { context: samlResponseXml } = await idp.createLoginResponse(sp, { extract: { request: { id: neverIssuedRequestId } } }, 'post', { email: 'unissued.request@customer-enterprise.test' });

  const res = await request(app)
    .post(`/api/auth/saml/${ORG}/acs`)
    .type('form')
    .send({ SAMLResponse: samlResponseXml });

  assert.equal(res.status, 400);
  const Users = require('../models/user_model');
  const profile = await Users.findOne({ email: 'unissued.request@customer-enterprise.test' });
  assert.equal(profile, null, 'a response tied to a request this SP never issued must never provision a user or a session');
});
