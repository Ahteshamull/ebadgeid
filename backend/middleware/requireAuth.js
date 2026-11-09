// middleware/requireAuth.js
//
// Consolidated auth guard applied to every protected route (see
// AUDIT_FIXES.md, hallazgo 1.1). It verifies the JWT issued by
// controllers/authController.js (POST /api/auth/login) — the single auth
// system in this codebase since the V2 system was removed (hallazgo 1.2) —
// and exposes a normalized req.user identity.
//
// Accepts the token from either the Authorization header (what the
// frontend uses today, via localStorage) or the httpOnly cookie the login
// endpoint now also sets — whichever a given caller sends. This lets the
// frontend migrate off localStorage incrementally later without another
// backend change.
const jwt = require('jsonwebtoken');
const { getCached } = require('../utils/cache');
const { revokedTokenKey } = require('../utils/tokenRevocation');
const AUTH_COOKIE_NAME = 'ebadge_token';

const requireAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const headerToken = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"
  const token = headerToken || req.cookies?.[AUTH_COOKIE_NAME];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    // Real revocation, not just a client-side cookie clear -- see
    // utils/tokenRevocation.js and authController.js's logout(). getCached
    // already fails open (returns null) on any Redis error, so this can
    // never itself be the reason a legitimate request fails.
    if (decoded.jti && await getCached(revokedTokenKey(decoded.jti))) {
      return res.status(401).json({ message: 'This session has been logged out' });
    }
    req.user = {
      id: decoded.id,
      username: decoded.username,
      // Normalized here, at the single point where a session is built,
      // rather than at each gate: 'super_admin' is a legacy spelling of
      // this codebase's 'platform_admin' top tier, held by a real account
      // in the production database (verified live). There are ~11 places
      // downstream that compare req.user.role to 'platform_admin'
      // directly -- cross-tenant listing, org status changes, user
      // management, storage uploads. Patching each one would work until
      // the next one is added and silently misses this case; collapsing
      // the two spellings once, here, means every existing and future
      // check is correct by construction. The raw token value is left
      // untouched; only this request's view of it is canonicalized.
      role: decoded.role === 'super_admin' ? 'platform_admin' : decoded.role,
      organization_code: decoded.organization_code,
    };
    next();
  } catch (err) {
    // 401, not 403. A token that is malformed, expired or signed with the
    // wrong key is an AUTHENTICATION failure -- there is no valid identity --
    // whereas 403 means "we know who you are, and you may not do this".
    //
    // Answering 403 here had two real consequences, in opposite directions:
    // the axios client only redirects to login on 401, so an expired session
    // surfaced as an unexplained permission error instead of sending the user
    // back to sign in; and apiFetch, to compensate, treated EVERY 403 as a
    // dead session -- so a legitimate "Admin access required" logged a
    // perfectly valid user out. Splitting the two codes fixes both.
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

// Only allows users whose token role is 'admin'. ('super_admin' arrives
// here already normalized to 'platform_admin' -- see requireAuth above.)
const requireAdmin = (req, res, next) => {
  if (!req.user || !['admin', 'platform_admin'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// LOW-01 fix (audit finding): the frontend's own sidebar/layout role
// checks (sidebar.js, and the requiredRole prop on api_tokens/, goals/,
// users/, credentials/, reports/organizations/'s layout.js files) already
// treat 'teacher' as equivalent to 'admin' for exactly these 5 sections --
// full page navigation, not narrowed to read-only. AuthCredentials never
// had a matching enum value, so no account could ever actually hold that
// role -- these frontend routes correctly rendered nothing broken for a
// 'teacher' session because no such session could ever exist, but the
// promised capability was real frontend code with no backend behind it.
// This is the corresponding backend gate: identical to requireAdmin,
// scoped to only the specific route files backing those same 5 sections
// (goal_routes.js, userRoutes.js, apiKeyRoutes.js) -- not swapped into
// requireAdmin itself, since that gates many other admin-only routes
// (organization settings, SAML config, billing, etc.) the frontend never
// exposes to a teacher session at all; broadening requireAdmin directly
// would grant far more than what was ever actually promised. Credentials
// listing and the reports/organizations dashboard already have no
// stricter-than-requireAuth gate at all, so they needed no change here.
const requireAdminOrTeacher = (req, res, next) => {
  if (!req.user || !['admin', 'platform_admin', 'teacher'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Admin or teacher access required' });
  }
  next();
};

const requirePlatformAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'platform_admin') {
    return res.status(403).json({ message: 'Platform administrator access required' });
  }
  next();
};

// Blocks a request if the org_code in the URL/body does not match the
// caller's own org_code — prevents an authenticated user from one
// organization from reading/editing another organization's data (IDOR,
// hallazgo 1.3). Admins of the platform are still scoped to their own org
// here; if you need a true super-admin role, add a separate check for it.
const requireOwnOrg = (paramName = 'organization_code') => (req, res, next) => {
  const requested = req.params[paramName] || req.body?.[paramName];
  if (requested && req.user?.organization_code && requested !== req.user.organization_code) {
    return res.status(403).json({ message: 'Not allowed to access another organization\'s data' });
  }
  next();
};

// Accepts either a user session (JWT, header or cookie) OR an API key
// (X-API-Key header). This is what an external integration (an LMS issuing
// credentials programmatically, for example) uses instead of a human
// login — see middleware/requireApiKey.js for what validates the key
// itself. The user-JWT path still requires the admin role (an API key is
// already scoped to exactly one organization by construction, so it
// doesn't need the same check).
const { requireApiKey } = require('./requireApiKey');
const requireAuthOrApiKey = (req, res, next) => {
  if (req.headers['x-api-key']) {
    return requireApiKey(req, res, next);
  }
  return requireAuth(req, res, (err) => {
    if (err) return next(err);
    return requireAdmin(req, res, next);
  });
};

module.exports = { requireAuth, requireAdmin, requireAdminOrTeacher, requirePlatformAdmin, requireOwnOrg, requireAuthOrApiKey };
