// middleware/publicOrganization.js
//
// Every public (unauthenticated) surface in this service -- FAQs, articles,
// anonymous ticket creation, the chat widget -- used to resolve "which
// organization is this for" from a single process.env.DEFAULT_ORG_CODE,
// making one help_backend deployment serve exactly one organization's
// public content no matter who's actually asking. This resolves the real
// tenant per request instead: the caller (widget, public page) sends the
// organization_code it was configured with, we validate it against a real
// Organizations document, and every downstream query scopes to that.
//
// organization_code is not a secret -- it's already exposed as a URL param
// elsewhere (GET /organizations/code/:code) and is meant to be embedded in
// a public-facing widget the same way a third-party app id would be.
const jwt = require("jsonwebtoken");
const Organization = require("../models/organization");

const CODE_PATTERN = /^[A-Za-z0-9_-]{2,50}$/;

async function resolvePublicOrganizationCode(rawCode) {
  const code = String(rawCode || '').trim();
  if (!CODE_PATTERN.test(code)) return null;
  const exists = await Organization.exists({ organization_code: code });
  return exists ? code : null;
}

// Reads organization_code from query (GET) or body (POST), validates it
// against the Organizations collection, and attaches it as
// req.organizationCode. 400s with a clear message otherwise -- callers
// should not fall back to guessing.
//
// If a logged-in staff/agent session cookie is already present (these
// routes are intentionally left open to anonymous visitors, so there's no
// authMiddleware() in front of them), that session's own org_code wins
// instead -- an admin browsing their own FAQs/articles shouldn't have to
// also pass organization_code on every request, and their session is a
// stronger signal than a client-supplied query param anyway. The JWT
// already carries org_code directly (see utils/generateToken.js), so this
// doesn't need a User lookup.
function requirePublicOrganization() {
  return async (req, res, next) => {
    const authHeader = req.header("Authorization");
    const token = authHeader?.split(" ")[1] || req.cookies?.helpdesk_token;
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        if (decoded.org_code) {
          req.organizationCode = decoded.org_code;
          return next();
        }
      } catch {
        // Invalid/expired staff token shouldn't block an otherwise-valid
        // public visitor request -- fall through to the query param path.
      }
    }

    const raw = req.query.organization_code || req.body?.organization_code;
    const code = await resolvePublicOrganizationCode(raw);
    if (!code) {
      return res.status(400).json({
        success: false,
        message: "A valid organization_code is required",
      });
    }
    req.organizationCode = code;
    next();
  };
}

module.exports = { resolvePublicOrganizationCode, requirePublicOrganization, CODE_PATTERN };
