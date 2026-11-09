// tests/samlSso.integration.test.js
//
// No real customer IdP exists to test against (every Enterprise
// customer's IdP is its own relationship -- see services/samlAuth.js's
// header comment). Instead: a real, self-signed X.509 cert/key pair
// (via `selfsigned`, generating actual RSA keys and a real certificate,
// not a stub) builds a real samlify IdentityProvider that signs a real
// SAML assertion -- the exact same samlify APIs a real IdP integration
// would use on the other side. That real, cryptographically-signed
// assertion is then fed through this system's real SP code
// (services/samlAuth.js, via the real HTTP routes), so the signature
// verification, user provisioning, and JWT issuance are all exercised
// for real, not mocked. What's not (and can't be, without one) tested:
// any specific real-world IdP's actual quirks (Okta/Azure AD/etc).
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
// REDIS_URL is now required for SAML SSO at all (see services/samlAuth.js's
// header comment -- SEC-AUDIT-4 follow-up: real replay protection has to
// be mandatory, not opt-in, for an authentication mechanism). Never
// actually dialed -- utils/cache.js's _setClientForTesting below injects a
// fake client before any real connection would be attempted. Same
// established pattern as tests/samlReplayProtection.integration.test.js.
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
    // semantics: refuse to overwrite a still-live key, atomically, so this
    // fake has to actually enforce that, not just accept and overwrite.
    async set(key, value, mode, ttlSeconds, nx) {
      if (nx === 'NX' && isLive(store.get(key))) return null;
      const expiresAt = mode === 'EX' ? Date.now() + ttlSeconds * 1000 : null;
      store.set(key, { value, expiresAt });
      return 'OK';
    },
    async del(key) {
      const existed = isLive(store.get(key));
      store.delete(key);
      return existed ? 1 : 0;
    },
    // utils/cache.js's consumeOnce (HIGH-01 fix) issues a real GETDEL --
    // read and delete in one atomic step, same reasoning as NX above.
    async call(command, key) {
      if (String(command).toUpperCase() === 'GETDEL') {
        const entry = store.get(key);
        store.delete(key);
        return isLive(entry) ? entry.value : null;
      }
      throw new Error(`fake redis client: unsupported command ${command}`);
    },
  };
}

// Fakes just enough of ioredis's surface for utils/distributedRateLimit.js's
// RedisRateLimitStore (INCR+PEXPIRE via a Lua eval, plus get/decr/del) --
// see the comment on _setRedisClientForTesting above for why this exists.
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

// Every test below builds its AuthnRequest directly via sp.createLoginRequest
// (not through a real GET /login call), so services/samlAuth.js never
// itself records that id as outstanding the way buildLoginRedirect() does
// for a real login. Since Layer 2 of the replay-protection fix now
// requires a matching outstanding-request record whenever InResponseTo is
// present, every test that expects a login to actually succeed has to
// seed that record itself -- same pattern already established in
// tests/samlReplayProtection.integration.test.js.
async function seedOutstandingRequest(organizationCode, requestId) {
  const { setCached } = require('../utils/cache');
  await setCached(`saml:outstanding-request:${organizationCode}:${requestId}`, true, 900);
}

let mongod;
let app;
const ORG = 'ORG-SAML-SSO';
let adminToken;
let fakeIdpCert;
let fakeIdpKey;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));

  const { _setClientForTesting } = require('../utils/cache');
  _setClientForTesting(createFakeRedisClient());

  // Root cause of a real, GitHub-Actions-only CI failure (never reproduced
  // locally despite extensive testing): the /login and /acs routes this
  // file exercises are both behind samlAuthLimiter (routes/samlRoutes.js),
  // a rate limiter backed by utils/distributedRateLimit.js's OWN, SEPARATE
  // ioredis client -- a completely different module from utils/cache.js
  // above, with its own connection to whatever REDIS_URL is set to. This
  // file sets REDIS_URL to a fake, unresolvable host (required for
  // samlAuth.js's own real-Redis-required checks to pass), which every
  // OTHER test file in this suite avoids ever doing -- so this was the one
  // and only place in the whole suite where a rate-limited route actually
  // tried a real network connection during a test run. Mocking it the same
  // way utils/cache.js is mocked above removes that as a source of
  // environment-dependent timing (a real "connect to a nonexistent host"
  // attempt can take very different amounts of time on different networks).
  const { _setRedisClientForTesting } = require('../utils/distributedRateLimit');
  _setRedisClientForTesting(createFakeRateLimitRedisClient());

  adminToken = jwt.sign({ id: 's1', username: 'saml_admin', role: 'admin', organization_code: ORG }, process.env.JWT_SECRET, { algorithm: 'HS256' });

  const Organization = require('../models/organization_schema');
  await Organization.create({
    organization_code: ORG, name: 'SAML SSO Org', city: 'C', state: 'S', country: 'PY',
    email: 'samlsso@example.test', phone: '0', status: 'ACTIVE', plan: 'Enterprise',
  });

  // A real, generated self-signed cert/key pair -- the "customer's IdP"
  // signing credential for this test, structurally identical to what a
  // real Okta/Azure AD tenant would hold.
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'test-idp.example.test' }], { keySize: 2048, days: 365, algorithm: 'sha256' });
  fakeIdpCert = pems.cert;
  fakeIdpKey = pems.private;
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('PUT /api/auth/saml/config stores the org\'s IdP trust relationship', async () => {
  const res = await request(app)
    .put('/api/auth/saml/config')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      idp_entity_id: 'https://test-idp.example.test/entity',
      idp_sso_url: 'https://test-idp.example.test/sso',
      idp_certificate: fakeIdpCert,
    });
  assert.equal(res.status, 200);
  assert.equal(res.body.idp_entity_id, 'https://test-idp.example.test/entity');
});

test('GET /api/auth/saml/:org/metadata returns real SP metadata XML', async () => {
  const res = await request(app).get(`/api/auth/saml/${ORG}/metadata`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /xml/);
  assert.match(res.text, /<(md:)?EntityDescriptor/);
  assert.match(res.text, new RegExp(`saml/${ORG}/acs`));
});

test('GET /api/auth/saml/:org/login redirects to the configured IdP with a real AuthnRequest', async () => {
  const res = await request(app).get(`/api/auth/saml/${ORG}/login`);
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /^https:\/\/test-idp\.example\.test\/sso\?/);
  assert.match(res.headers.location, /SAMLRequest=/);
});

test('POST /api/auth/saml/:org/acs with a real, validly-signed assertion provisions a real SSO user and issues a real session', async () => {
  const { buildServiceProvider } = require('../services/samlAuth');
  const sp = buildServiceProvider(ORG);
  const idp = samlify.IdentityProvider({
    entityID: 'https://test-idp.example.test/entity',
    privateKey: fakeIdpKey,
    signingCert: fakeIdpCert,
    singleSignOnService: [{ Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect', Location: 'https://test-idp.example.test/sso' }],
  });

  // A real SP-initiated AuthnRequest first (exactly what GET /login
  // produces), so the response below carries a real, schema-valid
  // InResponseTo matching it -- an empty/omitted InResponseTo is not
  // actually a valid xs:NCName per the real SAML XSD, which the xmllint
  // validator (correctly) enforces.
  const { id: requestId } = sp.createLoginRequest(idp, 'redirect');
  await seedOutstandingRequest(ORG, requestId);
  const requestInfo = { extract: { request: { id: requestId } } };

  // A real, signed login response from the (fake but cryptographically
  // real) IdP, exactly as samlify's own SP-side code expects to receive
  // one over HTTP-POST binding.
  const { context: samlResponseXml } = await idp.createLoginResponse(
    sp,
    requestInfo,
    'post',
    { email: 'sso.user@customer-enterprise.test' }
  );

  const res = await request(app)
    .post(`/api/auth/saml/${ORG}/acs`)
    .type('form')
    .send({ SAMLResponse: samlResponseXml });

  assert.equal(res.status, 302);
  assert.match(res.headers.location, /sso=success/);
  const setCookie = res.headers['set-cookie']?.join(';') || '';
  assert.match(setCookie, /ebadge_token=/);

  const Users = require('../models/user_model');
  const profile = await Users.findOne({ email: 'sso.user@customer-enterprise.test', organization_code: ORG });
  assert.ok(profile, 'a first-time SSO login must provision a real user profile');
  assert.equal(profile.designation, 'SSO User');

  const AuthCredentials = require('../models/AuthCredentials');
  const auth = await AuthCredentials.findOne({ username: profile.username }).select('+password');
  assert.equal(auth.user_role, 'user');

  // The generated JWT itself must be a real, valid session token this
  // system's own requireAuth middleware would accept.
  const cookieMatch = setCookie.match(/ebadge_token=([^;]+)/);
  const decoded = jwt.verify(decodeURIComponent(cookieMatch[1]), process.env.JWT_SECRET);
  assert.equal(decoded.organization_code, ORG);
  assert.equal(decoded.username, profile.username);
});

test('POST /api/auth/saml/:org/acs rejects an assertion signed by an untrusted (different) IdP key', async () => {
  const { buildServiceProvider } = require('../services/samlAuth');
  const sp = buildServiceProvider(ORG);

  // A second, entirely different self-signed cert/key -- simulating an
  // attacker (or a misconfigured different IdP) trying to forge a login
  // for this organization.
  const forgedPems = await selfsigned.generate([{ name: 'commonName', value: 'attacker.test' }], { keySize: 2048, days: 365, algorithm: 'sha256' });
  const forgedIdp = samlify.IdentityProvider({
    entityID: 'https://test-idp.example.test/entity', // claims to be the trusted entity ID
    privateKey: forgedPems.private,
    signingCert: forgedPems.cert, // but signs with a DIFFERENT key than the one registered in PUT /config
    singleSignOnService: [{ Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect', Location: 'https://test-idp.example.test/sso' }],
  });

  const { id: forgedRequestId } = sp.createLoginRequest(forgedIdp, 'redirect');
  const { context: forgedResponseXml } = await forgedIdp.createLoginResponse(sp, { extract: { request: { id: forgedRequestId } } }, 'post', { email: 'attacker@evil.test' });

  const res = await request(app)
    .post(`/api/auth/saml/${ORG}/acs`)
    .type('form')
    .send({ SAMLResponse: forgedResponseXml });

  assert.equal(res.status, 400);

  const Users = require('../models/user_model');
  const forgedProfile = await Users.findOne({ email: 'attacker@evil.test' });
  assert.equal(forgedProfile, null, 'a forged assertion must never provision a user or a session');
});

// Security regression test -- found and confirmed live during an audit
// round by reading samlify's own source line by line: it extracts
// extract.audience and extract.response.destination but never itself
// compares either against anything. Before this fix, the only real trust
// boundary was signature verification against whatever certificate an
// org's admin registered -- and organizationSamlConfig.js's own comment
// already documents an IdP's signing certificate as "not secret data"
// (any legitimate customer can read it from their own IdP's metadata).
// This reproduces exactly that: a SECOND organization (never involved in
// issuing the assertion) registers the SAME IdP certificate Org A's real
// IdP uses, and is handed a real, validly-signed assertion that was
// actually issued for Org A (Audience = Org A's own SP entityID). Before
// the Audience/Destination fix, that assertion would have been accepted
// at Org B's ACS endpoint and logged the caller in as whoever it names,
// inside Org B. After the fix, it must be rejected.
test('POST /api/auth/saml/:org/acs rejects a validly-signed assertion that was issued for a DIFFERENT organization sharing the same IdP certificate', async () => {
  const ORG2 = 'ORG-SAML-SSO-VICTIM-OF-SHARED-IDP';
  const Organization = require('../models/organization_schema');
  await Organization.create({
    organization_code: ORG2, name: 'Org B (registers the same IdP cert as Org A)', city: 'C', state: 'S', country: 'PY',
    email: 'orgb@example.test', phone: '0', status: 'ACTIVE', plan: 'Enterprise',
  });
  const adminToken2 = jwt.sign({ id: 's2', username: 'saml_admin_org2', role: 'admin', organization_code: ORG2 }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  await request(app)
    .put('/api/auth/saml/config')
    .set('Authorization', `Bearer ${adminToken2}`)
    .send({
      idp_entity_id: 'https://test-idp.example.test/entity', // the SAME "not secret" IdP entity/cert Org A uses
      idp_sso_url: 'https://test-idp.example.test/sso',
      idp_certificate: fakeIdpCert,
    });

  const { buildServiceProvider } = require('../services/samlAuth');
  const spOrgA = buildServiceProvider(ORG); // the assertion below is built FOR Org A specifically
  const idp = samlify.IdentityProvider({
    entityID: 'https://test-idp.example.test/entity',
    privateKey: fakeIdpKey,
    signingCert: fakeIdpCert,
    singleSignOnService: [{ Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect', Location: 'https://test-idp.example.test/sso' }],
  });
  const { id: requestId } = spOrgA.createLoginRequest(idp, 'redirect');
  await seedOutstandingRequest(ORG, requestId);
  // A real, validly-signed assertion -- genuinely issued for Org A
  // (Audience = Org A's SP entityID), by the exact IdP certificate Org B
  // just registered as its own.
  const { context: samlResponseXml } = await idp.createLoginResponse(
    spOrgA,
    { extract: { request: { id: requestId } } },
    'post',
    { email: 'victim@customer-enterprise.test' }
  );

  // Submitted to Org B's ACS -- not Org A's. Signature verification alone
  // would pass (Org B registered the real, valid certificate). Only
  // Audience/Destination validation can catch that this assertion was
  // never meant for Org B.
  const res = await request(app)
    .post(`/api/auth/saml/${ORG2}/acs`)
    .type('form')
    .send({ SAMLResponse: samlResponseXml });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.message, /audience/i);

  const Users = require('../models/user_model');
  const hijacked = await Users.findOne({ email: 'victim@customer-enterprise.test', organization_code: ORG2 });
  assert.equal(hijacked, null, 'the assertion issued for Org A must never provision or log a user into Org B');

  // Sanity check: the exact same assertion, submitted to the organization
  // it was actually issued for, must still work -- this fix must not
  // break legitimate same-organization SSO.
  const legitRes = await request(app)
    .post(`/api/auth/saml/${ORG}/acs`)
    .type('form')
    .send({ SAMLResponse: samlResponseXml });
  assert.equal(legitRes.status, 302);
});

test('a second SSO login for the same email reuses the existing user, does not create a duplicate', async () => {
  const { buildServiceProvider } = require('../services/samlAuth');
  const sp = buildServiceProvider(ORG);
  const idp = samlify.IdentityProvider({
    entityID: 'https://test-idp.example.test/entity',
    privateKey: fakeIdpKey,
    signingCert: fakeIdpCert,
    singleSignOnService: [{ Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect', Location: 'https://test-idp.example.test/sso' }],
  });
  const { id: requestId } = sp.createLoginRequest(idp, 'redirect');
  await seedOutstandingRequest(ORG, requestId);
  const { context: samlResponseXml } = await idp.createLoginResponse(sp, { extract: { request: { id: requestId } } }, 'post', { email: 'sso.user@customer-enterprise.test' });

  await request(app)
    .post(`/api/auth/saml/${ORG}/acs`)
    .type('form')
    .send({ SAMLResponse: samlResponseXml });

  const Users = require('../models/user_model');
  const count = await Users.countDocuments({ email: 'sso.user@customer-enterprise.test', organization_code: ORG });
  assert.equal(count, 1, 'a second SSO login for the same email must not create a second account');
});

// A real, live Microsoft Entra ID tenant caught what every test above
// this one missed: none of them ever set an Origin header, so none of
// them exercised what a real browser actually sends when Entra ID's own
// hosted login page submits its SAMLResponse form to the ACS endpoint --
// Origin: https://login.microsoftonline.com, an origin this app's
// ALLOWED_ORIGINS allowlist (correctly) has no reason to know about.
// api.js used to reject that with two independent Origin checks (the
// cors() middleware, and a second CSRF-style allowlist check applied to
// every mutating /api/* request) before the request ever reached
// samlAuth.js at all. Both are now scoped to let this one path through --
// this test is what would have caught the regression before a real IdP
// did.
test('POST /api/auth/saml/:org/acs accepts a real, validly-signed assertion even when the browser sends a foreign Origin (the IdP\'s own)', async () => {
  const { buildServiceProvider } = require('../services/samlAuth');
  const sp = buildServiceProvider(ORG);
  const idp = samlify.IdentityProvider({
    entityID: 'https://test-idp.example.test/entity',
    privateKey: fakeIdpKey,
    signingCert: fakeIdpCert,
    singleSignOnService: [{ Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect', Location: 'https://test-idp.example.test/sso' }],
  });
  const { id: requestId } = sp.createLoginRequest(idp, 'redirect');
  await seedOutstandingRequest(ORG, requestId);
  const { context: samlResponseXml } = await idp.createLoginResponse(
    sp,
    { extract: { request: { id: requestId } } },
    'post',
    { email: 'foreign.origin.user@customer-enterprise.test' }
  );

  const res = await request(app)
    .post(`/api/auth/saml/${ORG}/acs`)
    .set('Origin', 'https://login.microsoftonline.com')
    .type('form')
    .send({ SAMLResponse: samlResponseXml });

  assert.equal(res.status, 302, `expected a successful SSO redirect, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.match(res.headers.location, /sso=success/);
});

// The exception above must not leak into the rest of the API -- a
// completely unrelated, real mutating route must still reject a request
// from an origin nobody configured, exactly as before. The cors()
// middleware rejects (and Express's error handler responds) before the
// request ever reaches the CSRF middleware added later in the chain, so
// that new middleware has no bearing on this specific rejection path --
// verified by running this suite for real, not assumed.
test('an unrelated mutating route still rejects a request from an origin not in ALLOWED_ORIGINS', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .set('Origin', 'https://evil-random-site.example')
    .send({ username: 'nobody', password: 'guess' });

  // A foreign origin is refused by one of TWO layers, and which one fires
  // depends on configuration, not on the request:
  //   - ALLOWED_ORIGINS configured -> the cors() layer throws and Express's
  //     error handler answers 500 "Not allowed by CORS".
  //   - ALLOWED_ORIGINS empty (a checkout with no .env) -> cors() treats
  //     that as local development, and the explicit fail-closed origin
  //     check in api.js answers 403 "Request origin is not allowed".
  // Asserting only the 500 made this test pass or fail on whether the
  // machine running it happened to have a .env file, which says nothing
  // about the product. What must hold either way is that the request is
  // REFUSED and never reaches the handler.
  assert.ok([403, 500].includes(res.status),
    `a foreign origin must be refused, got ${res.status}`);
  assert.match(res.body.message, /not allowed by cors|origin is not allowed/i);
});

// HIGH-01 (audit finding, confirmed real by code review before this fix):
// the previous getCached-then-setCached pair for replay protection was a
// genuine check-then-act race. This proves the fix (utils/cache.js's
// reserveOnce, a single atomic SET ... NX EX) against the actual race it
// was written for: the exact same captured, validly-signed SAMLResponse,
// POSTed twice at the same time, must never both succeed.
test('two concurrent ACS requests replaying the exact same SAMLResponse: exactly one succeeds, the other is rejected as a replay', async () => {
  const { buildServiceProvider } = require('../services/samlAuth');
  const sp = buildServiceProvider(ORG);
  const idp = samlify.IdentityProvider({
    entityID: 'https://test-idp.example.test/entity',
    privateKey: fakeIdpKey,
    signingCert: fakeIdpCert,
    singleSignOnService: [{ Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect', Location: 'https://test-idp.example.test/sso' }],
  });
  const { id: requestId } = sp.createLoginRequest(idp, 'redirect');
  await seedOutstandingRequest(ORG, requestId);
  const { context: samlResponseXml } = await idp.createLoginResponse(
    sp,
    { extract: { request: { id: requestId } } },
    'post',
    { email: 'concurrent.replay.user@customer-enterprise.test' }
  );

  const [first, second] = await Promise.all([
    request(app).post(`/api/auth/saml/${ORG}/acs`).type('form').send({ SAMLResponse: samlResponseXml }),
    request(app).post(`/api/auth/saml/${ORG}/acs`).type('form').send({ SAMLResponse: samlResponseXml }),
  ]);

  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [302, 400], `expected exactly one 302 (accepted) and one 400 (replay rejected), got ${first.status} and ${second.status}`);

  const Users = require('../models/user_model');
  const count = await Users.countDocuments({ email: 'concurrent.replay.user@customer-enterprise.test', organization_code: ORG });
  assert.equal(count, 1, 'two concurrent replays of the same response must still only ever provision one account');
});

// HIGH-01, second half: a degraded replay-protection store must fail
// CLOSED (503, login refused), never silently accept an assertion with no
// real replay protection in effect. Simulates Redis being unreachable by
// injecting a client whose commands reject, exactly as ioredis would
// surface a real connection failure to a caller awaiting it.
test('a broken/unreachable replay-protection store fails closed (503), not open', async () => {
  const { _setClientForTesting } = require('../utils/cache');
  const brokenClient = {
    async set() { throw new Error('simulated Redis outage'); },
    async get() { throw new Error('simulated Redis outage'); },
    async call() { throw new Error('simulated Redis outage'); },
    async del() { throw new Error('simulated Redis outage'); },
  };
  _setClientForTesting(brokenClient);

  try {
    const { buildServiceProvider } = require('../services/samlAuth');
    const sp = buildServiceProvider(ORG);
    const idp = samlify.IdentityProvider({
      entityID: 'https://test-idp.example.test/entity',
      privateKey: fakeIdpKey,
      signingCert: fakeIdpCert,
      singleSignOnService: [{ Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect', Location: 'https://test-idp.example.test/sso' }],
    });
    const { id: requestId } = sp.createLoginRequest(idp, 'redirect');
    // Not seeded (seedOutstandingRequest itself would hit the same broken
    // client and throw) -- irrelevant either way, since layer 1 (the
    // reserveOnce call) must reject before layer 2 is ever reached.
    const { context: samlResponseXml } = await idp.createLoginResponse(
      sp,
      { extract: { request: { id: requestId } } },
      'post',
      { email: 'redis-down-user@customer-enterprise.test' }
    );

    const res = await request(app)
      .post(`/api/auth/saml/${ORG}/acs`)
      .type('form')
      .send({ SAMLResponse: samlResponseXml });

    assert.equal(res.status, 503, `a broken replay-protection store must refuse the login (503), got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.message, /temporarily unavailable/i);

    const Users = require('../models/user_model');
    const count = await Users.countDocuments({ email: 'redis-down-user@customer-enterprise.test' });
    assert.equal(count, 0, 'no account may be provisioned when replay protection could not actually be enforced');
  } finally {
    _setClientForTesting(createFakeRedisClient());
  }
});
