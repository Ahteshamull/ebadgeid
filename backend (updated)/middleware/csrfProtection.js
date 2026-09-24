const crypto = require('crypto');

const CSRF_COOKIE_NAME = 'ebadge_csrf';
const AUTH_COOKIE_NAME = 'ebadge_token';

const cookieOptions = () => ({
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  ...(process.env.AUTH_COOKIE_DOMAIN ? { domain: process.env.AUTH_COOKIE_DOMAIN } : {}),
  maxAge: 24 * 60 * 60 * 1000,
});

function issueCsrfToken(res) {
  const token = crypto.randomBytes(32).toString('base64url');
  res.cookie(CSRF_COOKIE_NAME, token, cookieOptions());
  return token;
}

// Keep the browser's synchronizer-token lifecycle aligned with the session
// lifecycle.  This is particularly important when the API is hosted on a
// different subdomain: JavaScript at app.ebadgeid.com cannot read a
// host-only cookie written by api.ebadgeid.com, so it receives the token from
// GET /api/auth/csrf and keeps it in memory instead.  Clearing the cookie on
// logout prevents a stale synchronizer token from being reused accidentally.
function clearCsrfToken(res) {
  res.clearCookie(CSRF_COOKIE_NAME, cookieOptions());
}

function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // The IdP submits the SAML assertion as a cross-site top-level form;
  // routes/samlRoutes.js verifies its signed assertion cryptographically.
  if (/^\/api\/auth\/saml\/[^/]+\/acs$/.test(req.originalUrl.split('?')[0])) return next();
  // A bearer token/API key is supplied deliberately by JavaScript or an
  // integration, not automatically by the browser, so CSRF applies only
  // to the cookie-session transport.
  if (!req.cookies?.[AUTH_COOKIE_NAME]) return next();
  const supplied = req.get('x-csrf-token');
  const expected = req.cookies?.[CSRF_COOKIE_NAME];
  if (!supplied || !expected) return res.status(403).json({ message: 'CSRF token required' });
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    return res.status(403).json({ message: 'Invalid CSRF token' });
  }
  return next();
}

module.exports = { CSRF_COOKIE_NAME, cookieOptions, issueCsrfToken, clearCsrfToken, csrfProtection };
