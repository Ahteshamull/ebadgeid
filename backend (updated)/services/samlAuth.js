// services/samlAuth.js
//
// Generic SAML 2.0 SP-initiated SSO -- this system is always the Service
// Provider; each organization's own Identity Provider is configured
// per-org (models/organizationSamlConfig.js), not hardcoded to one
// vendor. No specific customer IdP is integrated against here (every
// Enterprise customer's IdP is its own relationship -- see the ideal-
// workflow notes this was scoped from); this is the one generic contract
// (SAML 2.0, HTTP-POST binding, signed assertions required) an org's IdP
// admin configures against, using our own SP metadata
// (GET /api/auth/saml/:organization_code/metadata) to set up the trust.
//
// On a successful, signature-verified assertion, the user is
// provisioned/looked-up by email and issued this system's own normal JWT
// (jsonwebtoken, same HS256 + same claims shape requireAuth already
// expects) -- so nothing else in the app needs to know a session came
// via SSO instead of a password login.
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const samlify = require('samlify');
// samlify refuses to parse any inbound XML at all until a schema
// validator is registered -- by design, so nobody accidentally ships SAML
// support that trusts unvalidated XML (XXE and friends). This uses the
// real xmllint binary (via libxml2-utils, see the backend Dockerfile) to
// validate against the actual SAML 2.0 XSDs, not a stub that always
// passes.
samlify.setSchemaValidator(require('@authenio/samlify-node-xmllint'));
const OrganizationSamlConfig = require('../models/organizationSamlConfig');
const AuthCredentials = require('../models/AuthCredentials');
const Users = require('../models/user_model');
const logger = require('../utils/logger');
const { setCached, reserveOnce, consumeOnce } = require('../utils/cache');

// SEC-AUDIT-3 (deep technical & security audit): real replay protection,
// covering BOTH SP-initiated and IdP-initiated logins. Confirmed by
// reading samlify's own source (build/src/flow.js, extractor.js) and by
// running a real signed assertion through it: samlify extracts a
// response's own ID (extract.response.id, required on every SAML
// StatusResponseType by the core schema) and its InResponseTo (when
// present) but never checks either against anything -- without this, a
// validly-signed SAMLResponse, captured once, could be POSTed to the ACS
// again and accepted as a brand-new login for as long as its own
// NotOnOrAfter window (5 minutes by samlify's own default, confirmed the
// same way) allows.
//
// Two layers, both required now (SEC-AUDIT-4 follow-up -- a prior version
// of this fix only ever checked InResponseTo, which by SAML design (core
// §3.4.5.2) simply doesn't exist on an IdP-initiated login, silently
// leaving that entire flow with no replay protection at all):
//   1. Every response's own ID is recorded as consumed on first use,
//      regardless of how the login was initiated -- this is the real,
//      universal replay check.
//   2. For SP-initiated logins specifically, buildLoginRedirect() below
//      also records every AuthnRequest ID it issues as outstanding, and
//      handleAssertion additionally requires a matching InResponseTo when
//      the response claims to be answering one -- an extra layer proving
//      this SP actually asked for this specific login, not just that the
//      response hasn't been replayed.
// 15 minutes is deliberately longer than the assertion's own 5-minute
// validity window for both TTLs -- authentication at the IdP (MFA, etc.)
// can itself take several minutes, so a record created before that has to
// outlive the round trip, not just the assertion's own window.
//
// REDIS_URL is now REQUIRED for SAML SSO in every environment, not just
// production (previously opt-in, the same convention utils/cache.js and
// the bulk-issuance queue use elsewhere -- but "no real replay protection
// at all" is not an acceptable degraded mode for an authentication
// mechanism the way it is for a cache or a queue). Without it configured,
// SSO is refused outright (503) rather than silently accepting unprotected
// logins. Signature verification against the organization's stored
// certificate remains the real trust boundary either way, untouched by
// any of this -- this closes the *specific* gap of a captured, validly-
// signed response being replayable.
const OUTSTANDING_REQUEST_TTL_SECONDS = 15 * 60;
const SEEN_RESPONSE_TTL_SECONDS = 15 * 60;
function outstandingRequestKey(organizationCode, requestId) {
  return `saml:outstanding-request:${organizationCode}:${requestId}`;
}
function seenResponseKey(organizationCode, responseId) {
  return `saml:seen-response:${organizationCode}:${responseId}`;
}

function acsUrl(organizationCode) {
  const base = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  return `${base}/api/auth/saml/${encodeURIComponent(organizationCode)}/acs`;
}

// This system's own SP identity -- one per organization's ACS endpoint
// (so an assertion issued for Org A's IdP can't be replayed against Org
// B's callback), but otherwise the same SP settings for everyone.
function buildServiceProvider(organizationCode) {
  return samlify.ServiceProvider({
    entityID: `${(process.env.PUBLIC_APP_URL || '').replace(/\/$/, '')}/api/auth/saml/${encodeURIComponent(organizationCode)}/metadata`,
    assertionConsumerService: [{ Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST', Location: acsUrl(organizationCode) }],
    wantAssertionsSigned: true,
    authnRequestsSigned: false, // no SP-side signing key required to get started -- the IdP signing the assertion is the actual trust anchor
  });
}

async function buildIdentityProvider(organizationCode) {
  const config = await OrganizationSamlConfig.findOne({ organization_code: organizationCode, enabled: true });
  if (!config) return null;
  return {
    idp: samlify.IdentityProvider({
      entityID: config.idp_entity_id,
      singleSignOnService: [{ Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect', Location: config.idp_sso_url }],
      signingCert: config.idp_certificate,
    }),
    config,
  };
}

async function isConfigured(organizationCode) {
  const config = await OrganizationSamlConfig.findOne({ organization_code: organizationCode, enabled: true }).lean();
  return Boolean(config);
}

// SP-initiated: redirect the browser to the org's IdP with a real,
// well-formed AuthnRequest.
async function buildLoginRedirect(organizationCode) {
  const result = await buildIdentityProvider(organizationCode);
  if (!result) throw Object.assign(new Error('SSO is not configured for this organization'), { statusCode: 503 });
  if (!process.env.REDIS_URL) {
    // REDIS_URL is required for real replay protection (see the header
    // comment above) -- refusing to even start a login is safer than
    // starting one that handleAssertion will process with no protection.
    throw Object.assign(new Error('SSO is temporarily unavailable (replay-protection store not configured)'), { statusCode: 503 });
  }
  const sp = buildServiceProvider(organizationCode);
  const { id, context } = sp.createLoginRequest(result.idp, 'redirect');
  await setCached(outstandingRequestKey(organizationCode, id), true, OUTSTANDING_REQUEST_TTL_SECONDS);
  return context; // a ready-to-redirect-to URL
}

// A first-time SSO login provisions a real Users profile the same shape
// login already expects -- but with no locally-known password: a random,
// never-shared, unguessable hash so this account can only ever
// authenticate via SSO, never via POST /api/auth/login with a guessed or
// brute-forced password.
async function findOrProvisionSsoUser(organizationCode, email) {
  let profile = await Users.findOne({ email, organization_code: organizationCode });
  if (profile) return profile;

  const username = `sso-${crypto.randomBytes(8).toString('hex')}`;
  const unusablePasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  await AuthCredentials.create({ username, password: unusablePasswordHash, user_role: 'user' });
  profile = await Users.create({
    username,
    organization_code: organizationCode,
    first_name: email.split('@')[0],
    last_name: '(SSO)',
    designation: 'SSO User',
    // SAML assertions don't carry city/state/country by default, and
    // Users' schema requires non-empty strings (Mongoose's required
    // validator rejects '' the same as undefined) -- 'Unknown' rather than
    // a fake-looking real value, same convention as other optional-in-
    // practice-but-required-in-schema fields elsewhere in this codebase.
    city: 'Unknown', state: 'Unknown', country: 'Unknown',
    email,
    phone: '0000000',
    status: 'Active',
  });
  logger.info('sso_user_provisioned', { organization_code: organizationCode, username });
  return profile;
}

// The Assertion Consumer Service handler: verifies the assertion's
// signature (samlify does this against the org's stored idp_certificate,
// not something this code re-implements), extracts the authenticated
// user's email, and issues this system's own JWT.
async function handleAssertion(organizationCode, requestBody) {
  const result = await buildIdentityProvider(organizationCode);
  if (!result) throw Object.assign(new Error('SSO is not configured for this organization'), { statusCode: 503 });
  const sp = buildServiceProvider(organizationCode);

  const { extract } = await sp.parseLoginResponse(result.idp, 'post', { body: requestBody });

  // SEC-AUDIT-4 (security audit): Audience/Destination restriction, real
  // and mandatory. Confirmed by reading samlify's own source (build/src/
  // flow.js, extractor.js) line by line: the library extracts
  // extract.audience and extract.response.destination but never itself
  // compares either against anything -- signature verification alone
  // only proves the assertion was signed by the certificate configured
  // for THIS organization, not that it was ever meant for this
  // application/organization's callback specifically. Without this, an
  // admin of Organization B who configures the *same* IdP certificate
  // Organization A's IdP uses (organizationSamlConfig.js's own comment
  // already documents that certificate as "not secret data" -- any
  // legitimate customer can read it from their IdP's own metadata) could
  // accept a validly-signed assertion issued by that IdP for a
  // completely different application sharing the same corporate IdP, and
  // be logged into Organization B as whoever that assertion names. This
  // is exactly what AudienceRestriction exists in the SAML 2.0 spec to
  // prevent -- it's the mechanism that lets one IdP safely serve many
  // Service Providers. Both checks are mandatory (reject if the field is
  // simply missing, not only on a mismatch): an assertion with no
  // Audience restriction at all is not "unrestricted and therefore fine",
  // it is unverifiable as being meant for this SP, which is the same
  // failure mode as a wrong one.
  const expectedAudience = `${(process.env.PUBLIC_APP_URL || '').replace(/\/$/, '')}/api/auth/saml/${encodeURIComponent(organizationCode)}/metadata`;
  if (extract?.audience !== expectedAudience) {
    logger.error('saml_audience_mismatch', { organization_code: organizationCode, expected: expectedAudience, actual: extract?.audience || null });
    throw Object.assign(new Error('SAML assertion was not issued for this application (Audience mismatch)'), { statusCode: 400 });
  }
  const expectedDestination = acsUrl(organizationCode);
  if (extract?.response?.destination !== expectedDestination) {
    logger.error('saml_destination_mismatch', { organization_code: organizationCode, expected: expectedDestination, actual: extract?.response?.destination || null });
    throw Object.assign(new Error('SAML assertion was not issued for this endpoint (Destination mismatch)'), { statusCode: 400 });
  }

  if (!process.env.REDIS_URL) {
    // Same requirement as buildLoginRedirect: no replay-protection store,
    // no SSO. An IdP-initiated assertion could reach here without ever
    // going through buildLoginRedirect, so this has to be checked again
    // on this path independently.
    throw Object.assign(new Error('SSO is temporarily unavailable (replay-protection store not configured)'), { statusCode: 503 });
  }

  // Layer 1 -- universal, covers every login regardless of how it was
  // initiated: this exact response ID must never have been accepted
  // before. The Response ID is required on every SAML response by the
  // core schema (unlike InResponseTo, which simply doesn't exist on an
  // IdP-initiated login), so this is the check that actually protects an
  // IdP-initiated flow, not just an SP-initiated one.
  //
  // HIGH-01 fix (audit finding, confirmed real by code review): the
  // previous getCached-then-setCached pair was a genuine check-then-act
  // race -- two concurrent requests replaying the same captured
  // SAMLResponse could both see a miss before either wrote the "seen"
  // marker, and both would be accepted. It also failed OPEN if Redis was
  // unreachable (getCached returns null on any error, indistinguishable
  // from "never seen before"). reserveOnce is a single atomic
  // SET ... NX EX -- Redis itself guarantees only one caller can ever win
  // it for a given key, closing the race completely -- and throws instead
  // of returning a "safe" default on any Redis failure, which the catch
  // below turns into a hard 503 rather than an unprotected, accepted login.
  const responseId = extract?.response?.id;
  if (!responseId) {
    throw Object.assign(new Error('SAML response did not include an ID'), { statusCode: 400 });
  }
  const responseKey = seenResponseKey(organizationCode, responseId);
  let reservedResponse;
  try {
    reservedResponse = await reserveOnce(responseKey, SEEN_RESPONSE_TTL_SECONDS);
  } catch (error) {
    logger.error('saml_replay_store_unavailable', { organization_code: organizationCode, message: error.message });
    throw Object.assign(new Error('SSO is temporarily unavailable (replay-protection store not configured)'), { statusCode: 503 });
  }
  if (!reservedResponse) {
    logger.error('saml_replay_rejected', { organization_code: organizationCode, response_id: responseId });
    throw Object.assign(new Error('This login response was already used'), { statusCode: 400 });
  }

  // Layer 2 -- SP-initiated logins only: when the response claims to be
  // answering a specific AuthnRequest, that request must be one this SP
  // actually issued and hasn't already consumed. An IdP-initiated login
  // has no InResponseTo at all by SAML design (core §3.4.5.2) and simply
  // skips this extra layer -- layer 1 above still protects it.
  //
  // Same atomicity fix as layer 1: consumeOnce is an atomic GETDEL, so
  // "was this outstanding, and is it now consumed" happens in a single
  // Redis round trip -- a separate GET then DEL (the previous
  // getCached/invalidate pair) left the identical race window reserveOnce
  // closes above, and also fails closed (503) instead of open on a Redis
  // failure, same reasoning as layer 1.
  const inResponseTo = extract?.response?.inResponseTo;
  if (inResponseTo) {
    const key = outstandingRequestKey(organizationCode, inResponseTo);
    let seen;
    try {
      seen = await consumeOnce(key);
    } catch (error) {
      logger.error('saml_replay_store_unavailable', { organization_code: organizationCode, message: error.message });
      throw Object.assign(new Error('SSO is temporarily unavailable (replay-protection store not configured)'), { statusCode: 503 });
    }
    if (!seen) {
      logger.error('saml_unsolicited_response_rejected', { organization_code: organizationCode, in_response_to: inResponseTo });
      throw Object.assign(new Error('This login response was already used, expired, or was not issued by this application'), { statusCode: 400 });
    }
  }

  const email = extract?.nameID || extract?.attributes?.email;
  if (!email) throw Object.assign(new Error('SAML assertion did not include an email/NameID'), { statusCode: 400 });

  const profile = await findOrProvisionSsoUser(organizationCode, email);
  const authRecord = await AuthCredentials.findOne({ username: profile.username });

  // jti: same real-revocation mechanism as a normal password login (see
  // authController.js's login/logout and utils/tokenRevocation.js) -- an
  // SSO session logs out through the exact same POST /api/auth/logout,
  // so it needs the same per-token ID for that to actually revoke it.
  const token = jwt.sign(
    { id: authRecord._id, username: profile.username, role: authRecord.user_role, organization_code: organizationCode, jti: crypto.randomUUID() },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );
  return { token, username: profile.username, organization_code: organizationCode };
}

function buildMetadataXml(organizationCode) {
  return buildServiceProvider(organizationCode).getMetadata();
}

module.exports = { isConfigured, buildLoginRedirect, handleAssertion, buildMetadataXml, findOrProvisionSsoUser, buildServiceProvider, buildIdentityProvider };
