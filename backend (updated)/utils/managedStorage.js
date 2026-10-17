const StoredFile = require('../models/StoredFile');

const STORAGE_KEY_PATTERN = /^(?:profile-|font-|ai-)?[a-z0-9-]*[a-f0-9]{32}\.(?:png|jpe?g|webp|pdf|ttf|otf|woff2?)$/i;

const allowedStorageOrigins = () => {
  const origins = new Set();
  const add = (val) => {
    if (!val || typeof val !== 'string') return;
    try {
      origins.add(new URL(val.trim()).origin);
    } catch {}
  };
  add(process.env.PUBLIC_STORAGE_BASE_URL);
  add(process.env.STORAGE_INTERNAL_BASE_URL);
  add(process.env.PUBLIC_API_BASE_URL);
  (process.env.ALLOWED_ORIGINS || '').split(',').forEach(add);
  (process.env.CREDENTIAL_IMAGE_ALLOWED_ORIGINS || '').split(',').forEach(add);
  origins.add('https://ebadgeid.onrender.com');
  origins.add('https://api.ebadgeid.com');
  origins.add('https://app.ebadgeid.com');
  origins.add('http://localhost:5000');
  origins.add('http://localhost:9000');
  return origins;
};

const managedStorageUrl = value => {
  try {
    const parsed = new URL(value);
    const origins = allowedStorageOrigins();
    if (!origins.has(parsed.origin)) return { valid: false };
    if (parsed.pathname.startsWith('/uploads/')) return { valid: true, legacy: true };
    const match = parsed.pathname.match(/^\/api\/files\/([^/]+)$/);
    if (!match || !STORAGE_KEY_PATTERN.test(decodeURIComponent(match[1]))) return { valid: false };
    return { valid: true, legacy: false, storageKey: decodeURIComponent(match[1]) };
  } catch {
    return { valid: false };
  }
};

const isManagedStorageUrl = value => managedStorageUrl(value).valid;

// Legacy files predate ownership metadata. They are kept compatible only
// while ALLOW_LEGACY_PUBLIC_UPLOADS is enabled. Every metadata-backed file
// must prove ownership before another tenant can reference it.
const belongsToOrganization = async (value, organizationCode) => {
  const parsed = managedStorageUrl(value);
  if (!parsed.valid) return false;
  // The default remains compatible with existing deployments. Operators
  // explicitly complete the cut-over with ALLOW_LEGACY_PUBLIC_UPLOADS=false.
  if (parsed.legacy) return process.env.ALLOW_LEGACY_PUBLIC_UPLOADS !== 'false';
  return Boolean(await StoredFile.exists({
    storage_key: parsed.storageKey,
    organization_code: organizationCode,
    deleted_at: null,
  }));
};

module.exports = { STORAGE_KEY_PATTERN, managedStorageUrl, isManagedStorageUrl, belongsToOrganization };
