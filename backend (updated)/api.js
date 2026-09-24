const express = require('express');
const dotenv = require('dotenv');
dotenv.config();
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const cookieParser = require('cookie-parser');
const { csrfProtection } = require('./middleware/csrfProtection');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const logger = require('./utils/logger');
const { createRateLimitStore } = require('./utils/distributedRateLimit');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const organizationRoutes = require('./routes/organizationRoutes');
const credentialRoutes = require('./routes/credential_routes');
const userRoutes = require('./routes/userRoutes');
const goalRoutes = require('./routes/goal_routes');
const scoreRoutes = require('./routes/scoreRoutes');
const invitationRoutes = require('./routes/invitation_routes');
const designRoutes = require('./routes/designRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const completionRoutes = require('./routes/completionRoutes');
const performanceRouter = require('./routes/user_dash_algorithm');
const organizationPerformance = require('./routes/organization_dashboard');
const apiKeyRoutes = require('./routes/apiKeyRoutes');
const startFreeTrial = require('./routes/freeTrialRoute');
const digitalContractRoutes = require('./routes/digitalContractRoutes');
const anchorRoutes = require('./routes/anchorRoutes');
const lmsWebhookRoutes = require('./routes/lmsWebhookRoutes');
const samlRoutes = require('./routes/samlRoutes');
const brandKitRoutes = require('./routes/brandKitRoutes');
const designShareRoutes = require('./routes/designShareRoutes');
const organizationAssetRoutes = require('./routes/organizationAssetRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
// Import routes
const overviewRoutes = require('./routes/overviewRoutes');

const cors = require('cors');
const app = express();

if (process.env.NODE_ENV === 'production') {
  const required = [
    'MONGO_URI', 'REDIS_URL', 'JWT_SECRET', 'HELPDESK_JWT_SECRET', 'PUBLIC_STORAGE_BASE_URL',
    'STORAGE_INTERNAL_BASE_URL', 'PUBLIC_API_BASE_URL', 'PUBLIC_APP_URL', 'CONTRACT_APP_URL', 'CERTIFICATE_SERVICE_URL',
    'CERTIFICATE_INTERNAL_KEY', 'ENCRYPTION_SECRET', 'BACKUP_ENCRYPTION_KEY', 'EMAIL_USER', 'EMAIL_PASS',
  ];
  for (const name of required) {
    if (!process.env[name]) throw new Error(`${name} is required in production`);
  }
  for (const name of ['JWT_SECRET', 'HELPDESK_JWT_SECRET', 'CERTIFICATE_INTERNAL_KEY', 'ENCRYPTION_SECRET', 'BACKUP_ENCRYPTION_KEY']) {
    if (process.env[name].length < 32) throw new Error(`${name} must contain at least 32 characters in production`);
  }
  for (const name of ['PUBLIC_STORAGE_BASE_URL', 'PUBLIC_API_BASE_URL', 'PUBLIC_APP_URL', 'CONTRACT_APP_URL']) {
    if (new URL(process.env[name]).protocol !== 'https:') throw new Error(`${name} must use HTTPS in production`);
  }
}

const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || '0', 10);
app.set('trust proxy', Number.isFinite(trustProxyHops) ? trustProxyHops : 0);

// Security headers (was missing here even though it's already a
// dependency and already used correctly in help_backend/api.js).
app.use(helmet());

// CORS: restrict to known frontends instead of allowing any origin.
// Set ALLOWED_ORIGINS in .env as a comma-separated list, e.g.
// "https://app.ebadgeid.com,https://helpdesk.ebadgeid.com"
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  throw new Error('ALLOWED_ORIGINS is required in production');
}
// POST /api/auth/saml/:organization_code/acs (routes/samlRoutes.js) is not
// like every other route below -- it's hit by a real browser doing a
// top-level <form> POST that the IdP's own hosted login page submits, not
// a fetch()/XHR call from one of this app's known frontends. Confirmed
// against a live Microsoft Entra ID tenant: the browser sends
// `Origin: https://login.microsoftonline.com` on that POST (the IdP's own
// origin, since it's the one that submitted the form) -- which the
// allowlist below correctly doesn't recognize, and the origin check used
// to reject it exactly like it should reject a genuine cross-site fetch
// from an unknown site. But an Access-Control-* response header was never
// actually this endpoint's real security boundary: those headers only
// govern whether JavaScript can *read* a cross-origin fetch/XHR response --
// they don't stop a plain cross-origin form POST from reaching the server,
// and they don't stop the browser from following the redirect the ACS
// handler responds with. The actual trust boundary here is entirely
// samlAuth.js's cryptographic verification of the assertion's signature
// against the organization's stored idp_certificate, completely untouched
// by this. samlAcsPathPattern scopes the exception to exactly this one
// path -- not the rest of /api/auth/saml/*, nowhere near the rest of /api.
const samlAcsPathPattern = /^\/api\/auth\/saml\/[^/]+\/acs$/;
const corsOriginCheck = (origin, callback) => {
  // Allow non-browser tools (curl, server-to-server) with no Origin header,
  // and any origin explicitly whitelisted in .env.
  if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
    return callback(null, true);
  }
  return callback(null, false);
};
app.use(cors((req, callback) => {
  if (samlAcsPathPattern.test(req.originalUrl.split('?')[0])) {
    // `origin: true` reflects back whatever Origin the request actually
    // sent (here, login.microsoftonline.com) -- not the literal '*'
    // wildcard, and scoped to just this one path.
    return callback(null, { origin: true, credentials: true });
  }
  return callback(null, { origin: corsOriginCheck, credentials: true });
}));

// Parsers must run before limit key generation: cookie-based sessions and
// normalized login identifiers are part of the distributed limit keys.
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Strips any $-prefixed or dot-containing key from req.body (e.g. a client
// sending {"username": {"$ne": null}}) before it can reach a Mongoose
// query as a real operator instead of a literal value. Scoped to req.body
// only, not req.query/req.params: Express 5 makes those getter-only, and
// mongoSanitize()'s normal auto-middleware reassigns them directly, which
// throws on every single request (verified: TypeError, 500). req.body is
// a plain writable property set by express.json() above, so reassigning
// it here is safe. The one confirmed real query-string vector found in
// audit (organizationAssetController.js's asset_type filter) is handled
// at its own call site instead, with an explicit enum check.
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = mongoSanitize.sanitize(req.body);
  }
  next();
});

// Global rate limit — protects every route from brute force / scraping.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: process.env.NODE_ENV !== 'production',
  store: createRateLimitStore('global'),
  message: { message: 'Too many requests from this IP, please try again later.' }
});
app.use('/api', globalLimiter);

// Per-organization limit — IP-based limiting alone means every user behind
// the same corporate NAT/VPN shares one budget, and a single legitimate
// high-traffic organization can't be distinguished from an attacker
// spreading requests across IPs. This runs before any route's requireAuth
// has executed, so req.user isn't set yet here — it decodes the token
// itself (best-effort; an invalid/missing token just falls back to IP,
// requireAuth downstream still rejects the request on its own terms).
const jwt = require('jsonwebtoken');
const extractOrgCode = (req) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || req.cookies?.ebadge_token;
    if (!token) return null;
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    return decoded.organization_code || null;
  } catch {
    return null;
  }
};
const orgLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  keyGenerator: (req, res) => extractOrgCode(req) || ipKeyGenerator(req.ip),
  skip: (req) => !extractOrgCode(req), // unauthenticated requests: global limiter above already applies
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: process.env.NODE_ENV !== 'production',
  store: createRateLimitStore('organization'),
  message: { message: 'This organization has exceeded its request budget for this window.' }
});
app.use('/api', orgLimiter);

// Tighter limit specifically on login/register — the endpoint most
// valuable to brute-force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  // `usernameOrEmail` was missing here, and it is the field the
  // onboarding app's recovery screen actually sends -- so every password
  // recovery started from that app keyed on the bare IP instead of the
  // account, putting unrelated users behind one NAT/office IP into a
  // single shared 20-request budget and letting one person's retries
  // lock everyone else out of recovering their own account.
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.username || req.body?.usernameOrEmail || req.body?.email || '').trim().toLowerCase()}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: process.env.NODE_ENV !== 'production',
  store: createRateLimitStore('auth'),
  message: { message: 'Too many auth attempts, please try again later.' }
});
// Scoped to the actual credential-guessing surface only -- NOT the whole
// /api/auth prefix. GET /me and POST /logout aren't brute-forceable (they
// require an already-valid session, not a guessed credential), but they
// share this bucket incorrectly if mounted broadly: the frontend calls
// useSession() -> GET /api/auth/me independently from several components
// on every page (Header, Sidebar, ...) with no shared cache, and since
// the keyGenerator falls back to just the IP when there's no
// username/email in the body (true for every GET /me call), a handful of
// normal page loads was enough to exhaust the 20-req/15min budget and
// lock an already-authenticated admin out of their own session -- found
// via qa_final_harness.js browser-driven testing, not by reading the code.
// forgot-password/reset-password added here for the same reason as
// activate/resend-activation: forgot-password could otherwise be used to
// mass-spam arbitrary inboxes, and reset-password is a raw token-guessing
// surface (a 32-byte token is uninguessable in a normal request budget,
// but a 15-min/20-attempt cap is layered on regardless, same as every
// other token-based auth surface here).
app.use(['/api/auth/login', '/api/auth/register', '/api/auth/activate', '/api/auth/resend-activation', '/api/auth/forgot-password', '/api/auth/verify-otp', '/api/auth/reset-password'], authLimiter);

// Only actually starts a BullMQ Worker if REDIS_URL is configured — see
// queues/bulkIssuanceWorker.js. No-op otherwise, same as the caching
// layer: bulk issuance without a configured queue just isn't offered
// (the route returns 503), not silently broken.
const { startBulkIssuanceWorker } = require('./queues/bulkIssuanceWorker');
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // A second, independent Origin allowlist check (CSRF-style defense-in-
  // depth on state-changing requests) -- separate from the cors()
  // middleware above, so the same SAML ACS exception has to be repeated
  // here too, for the same reason: confirmed for real that Microsoft
  // Entra ID's hosted login page submits its POST to this endpoint with
  // Origin: https://login.microsoftonline.com, which this allowlist
  // (correctly) doesn't recognize. This route's real protection is
  // samlAuth.js's signature verification against the org's stored
  // idp_certificate, not an Origin header -- see the longer comment on
  // samlAcsPathPattern above.
  if (samlAcsPathPattern.test(req.originalUrl.split('?')[0])) return next();
  const origin = req.get('origin');
  if (origin && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ message: 'Request origin is not allowed' });
  }
  next();
});
app.use('/api', csrfProtection);

// Structured request log — one JSON line per request with the fields that
// actually matter for debugging in production (who, what, how long, what
// status). Replaces the total absence of request logging that existed
// before; console.log statements scattered in individual controllers are a
// separate, lower-priority cleanup — see AUDIT_FIXES.md.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('http_request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Date.now() - start,
      organization_code: req.user?.organization_code || null,
      username: req.user?.username || null,
    });
  });
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/keys', apiKeyRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/contracts', digitalContractRoutes);
app.use('/api/anchors', anchorRoutes);
app.use('/api/lms', lmsWebhookRoutes);
app.use('/api/auth/saml', samlRoutes);
app.use('/api/brand-kit', brandKitRoutes);
app.use('/api/design-shares', designShareRoutes);
app.use('/api/users', userRoutes);
app.use('/api/credentials', credentialRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/scores', scoreRoutes);
app.use('/api/invitation', invitationRoutes);
app.use('/api/designs', designRoutes)
app.use('/api/assets', organizationAssetRoutes);
app.use('/api/uploads', uploadRoutes);
// Kept only for an explicit, time-bounded migration of existing credential
// links. All new tenant files are served by storage.js through /api/files.
if (process.env.ALLOW_LEGACY_PUBLIC_UPLOADS === 'true') {
  app.use('/uploads', express.static(require('path').join(__dirname, 'uploads'), {
    setHeaders(res) {
      res.setHeader('Deprecation', 'true');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }));
} else {
  app.use('/uploads', (req, res) => res.status(410).json({ message: 'Legacy public upload URLs are disabled' }));
}
app.use('/api/completions', completionRoutes);
app.use('/api/performance', performanceRouter);
app.use('/api/overview', overviewRoutes);
app.use('/api/organization_performance', organizationPerformance)
app.use('/api', startFreeTrial);

// Centralized error handler — controllers still catch and respond on their
// own for expected errors, but this is a backstop so an unhandled error
// never leaks a raw stack trace to the client.
app.use((err, req, res, next) => {
  logger.error('unhandled_error', {
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    path: req.originalUrl,
    method: req.method,
  });
  res.status(err.status || 500).json({
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// Was entirely missing — the main API had no health endpoint at all,
// which is what load balancers, uptime monitors, and (previously fake)
// status pages actually need to check. mongoose.connection.readyState:
// 1 = connected, the only state that means "actually healthy" here.
const mongoose = require('mongoose');
app.get('/', (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  res.json({
    service: 'eBadgeID Core API Server',
    status: 'online',
    port: Number(PORT),
    database: dbConnected ? 'connected' : 'disconnected',
    health: '/health',
    timestamp: new Date().toISOString(),
  });
});
app.get('/health', (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'healthy' : 'degraded',
    database: dbConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// Serves this deployment's Ed25519 public key as a DID document — what a
// real Open Badges 3.0 verifier (or the 1EdTech conformance test tool)
// fetches to check a credential's signature (see
// utils/openBadgeSigning.js and credentialController.js:
// getCredentialAsOpenBadge). 404s, not a broken/empty document, when
// OB3_ISSUER_PRIVATE_KEY_PEM isn't configured — nothing to publish yet.
app.get('/.well-known/did.json', (req, res) => {
  const { isConfigured, loadIssuerKeyPair, verificationMethodId } = require('./utils/openBadgeSigning');
  if (!isConfigured()) {
    return res.status(404).json({ message: 'No issuer keypair is configured on this deployment (OB3_ISSUER_PRIVATE_KEY_PEM)' });
  }
  const appBaseUrl = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  const { publicKeyMultibase } = loadIssuerKeyPair();
  const did = `did:web:${appBaseUrl.replace(/^https?:\/\//, '').replace(/:/g, '%3A')}`;
  const verificationMethod = verificationMethodId(appBaseUrl, publicKeyMultibase);
  res.json({
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
    id: did,
    verificationMethod: [{
      id: verificationMethod,
      type: 'Multikey',
      controller: did,
      publicKeyMultibase,
    }],
    assertionMethod: [verificationMethod],
  });
});

app.use((req, res) => res.status(404).json({ message: 'Endpoint not found' }));

const PORT = process.env.PORT || 5000;
async function startServer() {
  await connectDB();
  // Real Ed25519 signing is the default now, not an opt-in manual step --
  // generates and persists an issuer keypair on first boot if
  // OB3_ISSUER_PRIVATE_KEY_PEM isn't set (see utils/openBadgeSigning.js).
  await require('./utils/openBadgeSigning').ensureIssuerKeypair();
  startBulkIssuanceWorker();
  return app.listen(PORT, () => logger.info('server_started', { port: Number(PORT) }));
}

if (require.main === module) {
  startServer().catch((error) => {
    logger.error('startup_failed', { message: error.message });
    process.exit(1);
  });
}

module.exports = { app, startServer };
