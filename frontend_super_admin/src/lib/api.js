// src/lib/api.js
//
// SA-01/SA-02 fix: this app used to store the raw JWT in
// localStorage/sessionStorage and attach it manually as an
// `Authorization: Bearer` header on every call, with zero CSRF
// protection and ~54 hardcoded `https://api.ebadgeid.com` literals
// scattered across ~30 files. The backend's own login endpoint already
// sets a real httpOnly session cookie on every successful login (see
// `backend (updated)/controllers/authController.js`'s `res.cookie(...)`)
// -- the token in the JSON response body was never meant to be the
// primary session mechanism, and the main `frontend` app never stored
// it client-side at all. This mirrors that already-proven pattern
// (`frontend/src/lib/api.js`) instead of inventing a new one.

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://api.ebadgeid.com/api';
export const STORAGE_BASE_URL = process.env.NEXT_PUBLIC_STORAGE_API_URL || 'https://storage.ebadgeid.com/api/uploads';

// Same reasoning as frontend/src/lib/api.js: api.ebadgeid.com and
// onboarding.ebadgeid.com are separate subdomains, so a host-only CSRF
// cookie set by the API is not readable from here. The token is fetched
// once from the authenticated bootstrap endpoint and kept only in this
// module's memory -- never localStorage/sessionStorage.
let csrfTokenCache = null;
let csrfBootstrapPromise = null;

export const getCsrfToken = () => csrfTokenCache;

export const setCsrfToken = (token) => {
  csrfTokenCache = typeof token === 'string' && token.length >= 32 ? token : null;
};

export async function ensureCsrfToken({ forceRefresh = false } = {}) {
  if (typeof window === 'undefined') return null;
  if (!forceRefresh && csrfTokenCache) return csrfTokenCache;
  if (!csrfBootstrapPromise) {
    csrfBootstrapPromise = fetch(`${API_BASE_URL}/auth/csrf`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || typeof payload.csrfToken !== 'string' || payload.csrfToken.length < 32) {
          throw new Error('Unable to initialize the security check. Please refresh and try again.');
        }
        setCsrfToken(payload.csrfToken);
        return csrfTokenCache;
      })
      .finally(() => {
        csrfBootstrapPromise = null;
      });
  }
  return csrfBootstrapPromise;
}

export function getAuthHeaders(extra = {}, isFormData = false) {
  return {
    // FormData bodies need the browser to set their own
    // `multipart/form-data; boundary=...` header -- forcing
    // application/json here would break every file upload silently.
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...extra,
  };
}

// Drop-in authenticated fetch wrapper. `path` is relative to
// API_BASE_URL, e.g. apiFetch('/organizations'). Session lives in the
// httpOnly cookie the backend already sets on login -- never read or
// written here. On 401/403 it sends the user back to login, same as the
// main app.
export async function apiFetch(path, options = {}) {
  const { redirectOnUnauthorized = true, ...fetchOptions } = options;
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const isFormData = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;
  const csrfToken = !['GET', 'HEAD', 'OPTIONS'].includes((fetchOptions.method || 'GET').toUpperCase())
    ? await ensureCsrfToken()
    : null;
  const response = await fetch(url, {
    ...fetchOptions,
    credentials: 'include',
    headers: getAuthHeaders({ ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...(fetchOptions.headers || {}) }, isFormData),
  });

  if (redirectOnUnauthorized && (response.status === 401) && typeof window !== 'undefined') {
    if (!window.location.pathname.startsWith('/auth/')) {
      window.location.href = '/auth/login';
    }
  }

  return response;
}

// SA-05 fix: uploads used to POST directly to the storage domain with no
// Authorization header and no credentials, against a storage service
// (`backend (updated)/storage.js`'s requireUploadAuth) that requires an
// authenticated session. This is the one authenticated upload path for
// the whole app -- every upload call site should go through this
// instead of a bare `fetch(STORAGE_API_URL, ...)`.
export async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiFetch(STORAGE_BASE_URL, { method: 'POST', body: formData, redirectOnUnauthorized: false });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || 'Upload failed');
  }
  const { url } = await response.json();
  return url;
}
