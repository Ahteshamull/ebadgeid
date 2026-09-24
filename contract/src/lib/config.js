// src/lib/config.js — centralized API config for the `contract` service.
// Same base URL was declared separately in 3 files; this is the one
// source of truth going forward.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://api.ebadgeid.com/api';
// Was `https://ftp.ebadgeid.com/api` — see frontend/src/lib/api.js for the
// full reasoning: `backend (updated)/storage.js` is a real, self-hosted
// storage service already wired via docker-compose.yml; this only changes
// the fallback used when NEXT_PUBLIC_UPLOAD_BASE_URL isn't set.
export const UPLOAD_BASE_URL = process.env.NEXT_PUBLIC_UPLOAD_BASE_URL || 'http://localhost:9000/api';
