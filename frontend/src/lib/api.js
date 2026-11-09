// src/lib/api.js
//
// Centralized API config + fetch helper. Before this, the API base URL was
// copy-pasted as a string literal in ~7+ different files, and none of the
// admin pages attached the Authorization header — which used to be
// harmless because those backend routes had no auth on them at all. Now
// that they do (see AUDIT_FIXES.md), every authenticated call needs to go
// through something that actually attaches the token, or it 401s.

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://ebadgeid.onrender.com/api';
export const UPLOAD_BASE_URL = process.env.NEXT_PUBLIC_UPLOAD_BASE_URL ?? '';

// Links saved while developing point at this machine. On the shared address
// those hosts are the visitor's own computer, so rewrite them to the site
// the browser is actually on. Leave them unchanged when this tab is local.
const LOCAL_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost:9000',
  'http://127.0.0.1:9000',
];

export function toPublicUrl(value) {
  if (typeof window === 'undefined' || typeof value !== 'string' || value.length === 0) return value;
  if (value.startsWith('data:') || value.startsWith('blob:')) return value;
  const here = window.location.origin;
  // Generated certificates and uploads are addressed at local ports or at a
  // previous quick tunnel. Another phone/PC cannot reach localhost, and
  // trycloudflare hosts die on every restart. The page they are actually
  // on already proxies /uploads and /api to this machine.
  let next = value;
  for (const local of LOCAL_ORIGINS) {
    if (local === here) continue;
    if (next.includes(local)) next = next.split(local).join(here);
  }
  try {
    const parsed = new URL(next, here);
    if (parsed.hostname.endsWith('.trycloudflare.com') && parsed.origin !== here) {
      return `${here}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Keep the rewritten string when it is not an absolute URL.
  }
  return next.replace(/([^:]\/)\/+/g, '$1');
}

function rewriteLocalHosts(value) {
  if (typeof value === 'string') return toPublicUrl(value);
  if (Array.isArray(value)) return value.map(rewriteLocalHosts);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, rewriteLocalHosts(nested)]));
  }
  return value;
}

// The API and web application deliberately use separate subdomains in
// production.  A host-only `ebadge_csrf` cookie written by api.ebadgeid.com
// is therefore not readable from app.ebadgeid.com.  The synchronizer token is
// fetched from the authenticated API bootstrap endpoint and retained only in
// this module's memory; the matching cookie remains browser-managed.
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

export function getAuthToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('ebadge_token');
}

export function setAuthToken(token) {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem('ebadge_token', token);
  } else {
    localStorage.removeItem('ebadge_token');
  }
}

export function getAuthHeaders(extra = {}, isFormData = false) {
  const token = getAuthToken();
  return {
    // FormData bodies need the browser to set their own
    // `multipart/form-data; boundary=...` header — forcing
    // application/json here would break every file upload silently (the
    // server would receive an unparseable body with the wrong boundary).
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...extra,
  };
}

// Drop-in fetch wrapper for authenticated calls to the eBadge ID API.
// `path` is relative to API_BASE_URL, e.g. apiFetch('/users/org/ACME').
// On a 401 (expired/invalid token) it clears the stored session and sends
// the user back to login — previously an expired token just meant every
// admin page silently failed with no explanation.
export async function apiFetch(path, options = {}) {
  const { redirectOnUnauthorized = true, timeoutMs = 20000, signal, ...fetchOptions } = options;
  const alreadyPrefixed = API_BASE_URL && (path === API_BASE_URL || path.startsWith(`${API_BASE_URL}/`));
  const url = toPublicUrl(path.startsWith('http') || alreadyPrefixed ? path : `${API_BASE_URL}${path}`);
  const isFormData = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;
  const csrfToken = !['GET', 'HEAD', 'OPTIONS'].includes((fetchOptions.method || 'GET').toUpperCase())
    ? await ensureCsrfToken()
    : null;
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) timeoutController.abort();
    else signal.addEventListener('abort', () => timeoutController.abort(), { once: true });
  }
  let response;
  try {
    response = await fetch(url, {
      ...fetchOptions,
      signal: timeoutController.signal,
      credentials: 'include',
      headers: getAuthHeaders({ ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...(fetchOptions.headers || {}) }, isFormData),
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('The server took too long to respond. Please try again.');
    }
    throw new Error(error?.message || 'Unable to reach the server.');
  } finally {
    clearTimeout(timer);
  }

  // Only 401. A 403 now means a real permission denial from a valid session
  // (requireAuth answers 401 for an invalid or expired token), and logging
  // someone out because they clicked an admin-only action would be wrong.
  if (redirectOnUnauthorized && response.status === 401 && typeof window !== 'undefined') {
    setAuthToken(null);
    window.location.href = '/auth/login';
  }

  const readJson = response.json.bind(response);
  response.json = async () => rewriteLocalHosts(await readJson());
  return response;
}

// Some pages use axios instead of fetch. Rather than rewrite every call
// site, this is a drop-in replacement for a bare `axios` import — same
// API, but it attaches the Authorization header and handles 401s the same
// way apiFetch does above.
import axios from 'axios';

export const apiClient = axios.create({ baseURL: API_BASE_URL, withCredentials: true, timeout: 20000 });

apiClient.interceptors.request.use(async (config) => {
  const csrfToken = !['get', 'head', 'options'].includes((config.method || 'get').toLowerCase())
    ? await ensureCsrfToken()
    : null;
  config.headers ||= {};
  const token = getAuthToken();
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  if (csrfToken) config.headers['X-CSRF-Token'] = csrfToken;
  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    response.data = rewriteLocalHosts(response.data);
    return response;
  },
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      setAuthToken(null);
      window.location.href = '/auth/login';
    }
    return Promise.reject(error);
  }
);

// Shared authenticated file upload helper. Attaches Authorization header
// and CSRF token via apiFetch and returns the primary file URL (for PDFs,
// returns original_pdf_url).
export async function uploadFile(file, { visibility = 'private' } = {}) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('visibility', visibility);

  // Same-origin /api/uploads is proxied by Next to the API. A separate
  // upload host is only used when NEXT_PUBLIC_UPLOAD_BASE_URL is set.
  const uploadEndpoint = UPLOAD_BASE_URL
    ? `${String(UPLOAD_BASE_URL).replace(/\/$/, '')}/api/uploads`
    : `${String(API_BASE_URL).replace(/\/$/, '')}/uploads`;
  const response = await apiFetch(uploadEndpoint, {
    method: 'POST',
    body: formData,
    redirectOnUnauthorized: false
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMsg = payload.message || payload.error || `Upload failed with status ${response.status}`;
    throw new Error(errorMsg);
  }

  return payload.original_pdf_url || payload.url;
}
