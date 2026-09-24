// services/tilopayClient.js
//
// Real Tilopay REST API client (https://documenter.getpostman.com/view/12758640/TVKA5KUT
// -- Tilopay's own published Postman collection, read directly, not
// guessed). Three real endpoints, all under TILOPAY_API_BASE_URL
// (default https://app.tilopay.com/api/v1):
//
//   POST /login            -- TILOPAY_API_USER/PASSWORD -> bearer token (24h)
//   POST /processPayment   -- creates a hosted payment-form URL to redirect the customer to
//   POST /processModification -- capture (1) / refund (2) / reversal (3) on an existing order
//
// IMPORTANT, read before relying on this for real money (see
// services/selfServiceSignup.js's handleTilopayReturn for how this is
// actually used): Tilopay's redirect back to this app after payment
// (the `redirect` URL passed to createPayment) carries the outcome as
// plain, unsigned query-string parameters (code=1 means approved). Their
// own documentation states the OrderHash field included in that redirect
// requires contacting sac@tilopay.com directly for the formula to
// validate it -- there is no publicly documented HMAC/signature scheme,
// unlike Stripe's webhook signing. This client and the flow built on top
// of it use an unguessable, randomly generated orderNumber (never
// sequential/predictable) as the only practical mitigation available
// without that formula. Get the real OrderHash validation instructions
// from Tilopay support before this handles real customer money in
// production, and wire the verification in at that point.
const TILOPAY_API_BASE_URL = (process.env.TILOPAY_API_BASE_URL || 'https://app.tilopay.com/api/v1').replace(/\/$/, '');

function isConfigured() {
  return Boolean(process.env.TILOPAY_API_USER && process.env.TILOPAY_API_PASSWORD && process.env.TILOPAY_API_KEY);
}

// Cached in module scope (one process = one merchant credential set) and
// refreshed with a 5-minute safety margin before the real 24h expiry
// Tilopay returns, rather than refreshing on every single call.
let cachedToken = null;
let cachedTokenExpiresAt = 0;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

async function getAccessToken() {
  if (!isConfigured()) {
    throw Object.assign(new Error('Tilopay is not configured (TILOPAY_API_USER/PASSWORD/KEY)'), { statusCode: 503 });
  }
  if (cachedToken && Date.now() < cachedTokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return cachedToken;
  }
  const response = await fetch(`${TILOPAY_API_BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiuser: process.env.TILOPAY_API_USER, password: process.env.TILOPAY_API_PASSWORD }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Tilopay login failed with status ${response.status}`), { statusCode: 502 });
  }
  const body = await response.json();
  if (!body.access_token) {
    throw Object.assign(new Error('Tilopay login response did not include an access_token'), { statusCode: 502 });
  }
  cachedToken = body.access_token;
  cachedTokenExpiresAt = Date.now() + (Number(body.expires_in) || 86400) * 1000;
  return cachedToken;
}

// `redirect` must be this app's own return URL (see
// services/selfServiceSignup.js) -- Tilopay sends the customer's browser
// back there via GET with the outcome in the query string. `orderNumber`
// must be unguessable (crypto.randomBytes-derived, never a sequential id)
// -- see this file's header comment on why that matters here.
async function createPayment({ orderNumber, amount, currency, redirect, billTo, capture = '1', subscription = '0', platform = 'ebadgeid', returnData }) {
  const token = await getAccessToken();
  const payload = {
    redirect,
    key: process.env.TILOPAY_API_KEY,
    amount: String(amount),
    currency,
    orderNumber,
    capture,
    subscription,
    platform,
    billToFirstName: billTo.firstName,
    billToLastName: billTo.lastName,
    billToAddress: billTo.address,
    billToAddress2: billTo.address2 || billTo.address,
    billToCity: billTo.city,
    billToState: billTo.state,
    billToZipPostCode: billTo.zip,
    billToCountry: billTo.country,
    billToTelephone: billTo.telephone,
    billToEmail: billTo.email,
    hashVersion: 'V2',
    token_version: 'v2',
  };
  if (returnData) payload.returnData = returnData;

  const response = await fetch(`${TILOPAY_API_BASE_URL}/processPayment`, {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.url) {
    throw Object.assign(new Error(body.description || `Tilopay processPayment failed with status ${response.status}`), { statusCode: 502 });
  }
  return { url: body.url, type: body.type };
}

// type: 1 = capture, 2 = refund, 3 = reversal (Tilopay's own numbering,
// see the Postman collection).
async function modifyTransaction({ orderNumber, type, amount }) {
  const token = await getAccessToken();
  const response = await fetch(`${TILOPAY_API_BASE_URL}/processModification`, {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderNumber, type: String(type), amount: String(amount), key: process.env.TILOPAY_API_KEY }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Tilopay processModification failed with status ${response.status}`), { statusCode: 502 });
  }
  return { success: true };
}

// Test-only hook: forces the next getAccessToken() call to re-authenticate
// instead of reusing whatever this process already cached.
function _resetTokenCacheForTests() {
  cachedToken = null;
  cachedTokenExpiresAt = 0;
}

module.exports = { isConfigured, getAccessToken, createPayment, modifyTransaction, _resetTokenCacheForTests };
