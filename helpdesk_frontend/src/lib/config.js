// src/lib/config.js
//
// Centralized API config for helpdesk_frontend. The base URL used to be
// declared as a local const, copy-pasted into each file that needed it
// (3 separate declarations, plus 56 more places calling
// `https://hapi.ebadgeid.com` directly as a raw string literal) — any
// environment change (staging, a new domain) meant editing every one of
// those by hand. This is one source of truth for the declared constant;
// the raw literals scattered through the codebase are a known remaining
// cleanup, not touched here — see AUDIT_FIXES.md for why (many of those
// call sites don't send an Authorization header either, and fixing the URL
// without fixing that would be cosmetic, not a real improvement).
export const API_BASE_URL = process.env.NEXT_PUBLIC_HELPDESK_API_URL || 'https://hapi.ebadgeid.com/api';
// Was `https://ftp.ebadgeid.com` — see frontend/src/lib/api.js for the full
// reasoning: `backend (updated)/storage.js` is a real, self-hosted storage
// service already wired via docker-compose.yml; this only changes the
// fallback used when NEXT_PUBLIC_UPLOAD_BASE_URL isn't set.
export const FTP_BASE_URL = process.env.NEXT_PUBLIC_UPLOAD_BASE_URL || 'http://localhost:9000';
export const CORE_API_ORIGIN = process.env.NEXT_PUBLIC_CORE_API_URL || 'https://api.ebadgeid.com';
export const HELPDESK_API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');
export const HELPDESK_WS_URL = process.env.NEXT_PUBLIC_HELPDESK_WS_URL || 'wss://hapi.ebadgeid.com';
// Identifies which organization's public help desk this deployment of
// helpdesk_frontend serves — the backend now resolves multi-tenant public
// data (FAQs, articles, chat) from this instead of a single fixed org on
// its own side. See help_backend/middleware/publicOrganization.js.
export const ORGANIZATION_CODE = process.env.NEXT_PUBLIC_ORGANIZATION_CODE || '';
