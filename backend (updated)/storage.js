const express = require('express');
const dotenv = require('dotenv');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const StoredFile = require('./models/StoredFile');
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { uploadMiddleware, handleUpload, fontUploadMiddleware, handleFontUpload, handleGenerateImage } = require('./controllers/uploadController');
const { createRateLimitStore } = require('./utils/distributedRateLimit');

dotenv.config();

if (process.env.NODE_ENV === 'production') {
  for (const name of ['REDIS_URL', 'JWT_SECRET', 'HELPDESK_JWT_SECRET', 'ALLOWED_ORIGINS']) {
    if (!process.env[name]) throw new Error(`${name} is required by the production storage service`);
  }
}

const app = express();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
app.set('trust proxy', Number.parseInt(process.env.TRUST_PROXY_HOPS || '0', 10) || 0);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(cookieParser());

// Security fix, found during an audit round: unlike api.js and
// help_backend/api.js, this service only ever had the cors() layer above
// -- no second, independent Origin allowlist check on state-changing
// requests (the same defense-in-depth both other backends apply). In
// practice this was mitigated by requireUploadAuth below requiring a
// sameSite:'strict' cookie (which doesn't travel cross-site at all), but
// it's a real gap in an otherwise-consistent pattern across all three
// Node services in this project, not a deliberate exception the way the
// SAML ACS route is in api.js.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Deliberately fails closed on an empty allowlist (unlike the cors()
  // layer above, which treats "no ALLOWED_ORIGINS configured" as a local-
  // dev "allow everything" fallback) -- matching api.js's own second
  // layer exactly, for the same reason: this only ever bites a from-
  // scratch checkout with no .env, never a real deployment (ALLOWED_ORIGINS
  // is already required at boot above when NODE_ENV==='production').
  const origin = req.get('origin');
  if (origin && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ message: 'Request origin is not allowed' });
  }
  next();
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: process.env.NODE_ENV !== 'production',
  store: createRateLimitStore('storage'),
  message: { message: 'Too many upload attempts, please try again later' },
});

// Tighter than uploadLimiter — each call is a real outbound request to a
// third-party generation API, slower and costlier than writing a local
// file, so a burst here should be throttled harder.
const generateImageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: process.env.NODE_ENV !== 'production',
  store: createRateLimitStore('storage-ai-image'),
  message: { message: 'Too many image generation attempts, please try again later' },
});

function requireUploadAuth(req, res, next) {
  const headerToken = req.get('authorization')?.split(' ')[1];
  const candidates = [
    { token: headerToken || req.cookies?.ebadge_token, secret: process.env.JWT_SECRET },
    { token: req.cookies?.helpdesk_token, secret: process.env.HELPDESK_JWT_SECRET },
  ];
  for (const candidate of candidates) {
    if (!candidate.token || !candidate.secret) continue;
    try {
      req.uploadIdentity = jwt.verify(candidate.token, candidate.secret, { algorithms: ['HS256'] });
      return next();
    } catch {
      // Try the next explicitly configured authentication domain.
    }
  }
  return res.status(401).json({ message: 'Authenticated upload session required' });
}

function authenticatedIdentity(req) {
  const headerToken = req.get('authorization')?.split(' ')[1];
  const candidates = [
    { token: headerToken || req.cookies?.ebadge_token, secret: process.env.JWT_SECRET },
    { token: req.cookies?.helpdesk_token, secret: process.env.HELPDESK_JWT_SECRET },
  ];
  for (const candidate of candidates) {
    if (!candidate.token || !candidate.secret) continue;
    try {
      return jwt.verify(candidate.token, candidate.secret, { algorithms: ['HS256'] });
    } catch {
      // Continue with the other session domain.
    }
  }
  return null;
}

const { STORAGE_KEY_PATTERN } = require('./utils/managedStorage');
const safeStorageKey = value => STORAGE_KEY_PATTERN.test(value || '');
const signedFileAccessValid = (storageKey, query) => {
  const expires = Number.parseInt(query.expires, 10);
  const signature = String(query.signature || '');
  if (!process.env.STORAGE_FILE_SIGNING_KEY || !Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac('sha256', process.env.STORAGE_FILE_SIGNING_KEY)
    .update(`${storageKey}:${expires}`).digest('base64url');
  const supplied = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return supplied.length === expectedBuffer.length && crypto.timingSafeEqual(supplied, expectedBuffer);
};

// All new uploads resolve through metadata + tenant identity. The file's
// random key is only an implementation detail, never the authorization
// mechanism. Legacy public URLs are handled below behind an explicit flag.
app.get('/api/files/:storageKey', async (req, res) => {
  const storageKey = req.params.storageKey;
  if (!safeStorageKey(storageKey)) return res.status(404).json({ message: 'File not found' });
  const signedAccess = signedFileAccessValid(storageKey, req.query);
  const identity = signedAccess ? null : authenticatedIdentity(req);
  const organizationCode = identity?.organization_code || identity?.org_code;
  try {
    const asset = await StoredFile.findOne({ storage_key: storageKey, deleted_at: null }).lean();
    if (!asset) return res.status(404).json({ message: 'File not found' });
    const isPublic = asset.visibility === 'public';
    if (!isPublic && !signedAccess && !identity) return res.status(401).json({ message: 'Authenticated file access required' });
    if (!isPublic && !signedAccess && !organizationCode) return res.status(403).json({ message: 'Organization-scoped session required' });
    if (!isPublic && !signedAccess && asset.organization_code !== organizationCode) return res.status(404).json({ message: 'File not found' });
    const target = path.join(__dirname, 'uploads', asset.storage_key);
    if (!fs.existsSync(target)) return res.status(404).json({ message: 'File not found' });
    res.set({
      'Content-Type': asset.mime_type,
      'Cache-Control': isPublic ? 'public, max-age=300' : (signedAccess ? 'private, max-age=60' : 'private, no-store'),
      'X-Content-Type-Options': 'nosniff',
    });
    return res.sendFile(target);
  } catch (error) {
    return res.status(500).json({ message: 'Unable to read stored file' });
  }
});

// Unlike plain /api/uploads (real non-admin uses: profile pictures in both
// apps' settings pages, helpdesk ticket attachments, article images --
// see the frontends' settings/page.js and ticket_details/page.js), font
// upload and AI image generation exist for exactly one purpose: the
// design editor, which is admin-only everywhere it's reachable from. This
// checks both token shapes requireUploadAuth can produce -- role for the
// main app's JWT, user_type for the helpdesk's -- since either could
// reach this route with a technically-valid session that isn't an admin.
function requireUploadAdmin(req, res, next) {
  const identity = req.uploadIdentity || {};
  const isAdmin = identity.role === 'admin' || identity.role === 'platform_admin' || identity.user_type === 'admin';
  if (!isAdmin) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

app.get('/', (req, res) => res.json({
  service: 'eBadgeID Storage Service',
  status: 'online',
  port,
  health: '/health',
  timestamp: new Date().toISOString()
}));
app.get('/health', (req, res) => res.json({ status: 'healthy', timestamp: new Date().toISOString() }));
app.post('/api/uploads', uploadLimiter, requireUploadAuth, uploadMiddleware, handleUpload);
app.post('/api/uploads/font', uploadLimiter, requireUploadAuth, requireUploadAdmin, fontUploadMiddleware, handleFontUpload);
app.post('/api/uploads/generate-image', generateImageLimiter, requireUploadAuth, requireUploadAdmin, express.json(), handleGenerateImage);
if (process.env.ALLOW_LEGACY_PUBLIC_UPLOADS === 'true') {
  app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    fallthrough: false,
    setHeaders(res, servedPath) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Deprecation', 'true');
      if (servedPath.endsWith('.md')) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    },
  }));
} else {
  app.use('/uploads', (req, res) => res.status(410).json({ message: 'Legacy public upload URLs are disabled' }));
}

app.use((error, req, res, next) => {
  if (error?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'File exceeds the 10 MB limit' });
  return res.status(error.status || 500).json({ message: 'Storage request failed' });
});

const port = Number.parseInt(process.env.STORAGE_PORT || (process.env.PORT && process.env.PORT !== '5000' ? process.env.PORT : '9000'), 10);
if (require.main === module) {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required by the metadata-backed storage service');
  }
  if (process.env.MONGO_URI.startsWith('mongodb+srv://')) {
    try { require('dns').setServers(['8.8.8.8', '1.1.1.1']); } catch (_) {}
  }
  mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 })
    .then(() => app.listen(port, () => console.log(`Storage service running on port ${port}`)))
    .catch((error) => {
      console.error(`Storage MongoDB connection failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { app };
