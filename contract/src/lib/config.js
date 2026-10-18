// src/lib/config.js — centralized API config for the `contract` service.
// Same base URL was declared separately in 3 files; this is the one
// source of truth going forward.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://ebadgeid.onrender.com/api';
export const UPLOAD_BASE_URL = process.env.NEXT_PUBLIC_UPLOAD_BASE_URL || 'https://ebadgeid.onrender.com';
