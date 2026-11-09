// utils/tokenRevocation.js
//
// Security fix, found during an audit round: JWTs had no real revocation
// mechanism -- POST /api/auth/logout only ever cleared the browser
// cookie; a captured token (copied out of localStorage, sniffed from a
// misconfigured proxy, whatever) stayed fully valid for the rest of its
// 1-day life regardless of the user having "logged out". This is the
// shared key format both sides of the fix use: authController.js's
// logout() records the current token's jti (a fresh, random ID minted at
// login -- see login()) as revoked; requireAuth.js checks every incoming
// token's jti against the same store before trusting it.
//
// Deliberately a denylist keyed by jti (revokes exactly the one session
// that logged out), not a per-user "everything before now is invalid"
// cutoff -- that would need a database read on literally every
// authenticated request in the app (requireAuth.js runs on almost every
// route). This is a single fast Redis GET, the same performance profile
// requireAuth.js already has zero of today, and consistent with how the
// rest of this codebase treats Redis as an available-but-optional,
// gracefully-degrading dependency (see utils/cache.js's own header
// comment) -- without REDIS_URL configured, logout still clears the
// cookie as before, it just can't guarantee the token itself stops
// working before it naturally expires, exactly the pre-fix behavior, not
// a worse one.
function revokedTokenKey(jti) {
  return `auth:revoked-jti:${jti}`;
}

module.exports = { revokedTokenKey };
