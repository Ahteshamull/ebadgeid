// src/lib/api.js
//
// Centralized API config + fetch helper. Before this, the API base URL was
// copy-pasted as a string literal in ~7+ different files, and none of the
// admin pages attached the Authorization header — which used to be
// harmless because those backend routes had no auth on them at all. Now
// that they do (see AUDIT_FIXES.md), every authenticated call needs to go
// through something that actually attaches the token, or it 401s.

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://ebadgeid.onrender.com/api';
export const UPLOAD_BASE_URL = process.env.NEXT_PUBLIC_UPLOAD_BASE_URL || 'https://ebadgeid.onrender.com';

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

  // Only 401. A 403 now means a real permission denial from a valid session
  // (requireAuth answers 401 for an invalid or expired token), and logging
  // someone out because they clicked an admin-only action would be wrong.
  if (redirectOnUnauthorized && response.status === 401 && typeof window !== 'undefined') {
    setAuthToken(null);
    window.location.href = '/auth/login';
  }

  return response;
}

// Some pages use axios instead of fetch. Rather than rewrite every call
// site, this is a drop-in replacement for a bare `axios` import — same
// API, but it attaches the Authorization header and handles 401s the same
// way apiFetch does above.
import axios from 'axios';

export const apiClient = axios.create({ baseURL: API_BASE_URL, withCredentials: true });

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
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      setAuthToken(null);
      window.location.href = '/auth/login';
    }
    return Promise.reject(error);
  }
);
