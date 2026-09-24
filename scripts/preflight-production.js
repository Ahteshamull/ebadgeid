#!/usr/bin/env node
// Safe configuration gate: reports missing/unsafe settings without ever
// printing secret values. Run inside the API container or locally after
// loading the target deployment's environment.
const required = [
  'MONGO_ROOT_PASSWORD', 'MONGO_APP_PASSWORD', 'MONGO_HELPDESK_APP_PASSWORD', 'MONGO_BACKUP_PASSWORD',
  'REDIS_PASSWORD', 'STORAGE_FILE_SIGNING_KEY',
  'JWT_SECRET', 'HELPDESK_JWT_SECRET', 'ENCRYPTION_SECRET', 'CERTIFICATE_INTERNAL_KEY', 'BACKUP_ENCRYPTION_KEY',
  'PUBLIC_STORAGE_BASE_URL', 'PUBLIC_API_BASE_URL', 'PUBLIC_APP_URL', 'PUBLIC_CONTRACT_APP_URL',
  'PUBLIC_HELPDESK_API_BASE_URL', 'PUBLIC_HELPDESK_WS_URL',
  'ALLOWED_ORIGINS', 'EMAIL_USER', 'EMAIL_PASS',
];
const missing = required.filter(name => !process.env[name] || process.env[name].startsWith('replace-with-'));
// A weak secret is a real, silent way to reach production unsafely -- this
// list was accidentally narrowed to only the Mongo/Redis/storage secrets
// during the P0-P3 remediation round (audit finding, confirmed real: JWT_SECRET,
// HELPDESK_JWT_SECRET, ENCRYPTION_SECRET, CERTIFICATE_INTERNAL_KEY and
// BACKUP_ENCRYPTION_KEY were silently dropped from this check, meaning a
// missing-strength JWT_SECRET could now reach production undetected).
const weak = [
  'MONGO_ROOT_PASSWORD', 'MONGO_APP_PASSWORD', 'MONGO_HELPDESK_APP_PASSWORD', 'MONGO_BACKUP_PASSWORD', 'REDIS_PASSWORD',
  'STORAGE_FILE_SIGNING_KEY', 'JWT_SECRET', 'HELPDESK_JWT_SECRET', 'ENCRYPTION_SECRET', 'CERTIFICATE_INTERNAL_KEY', 'BACKUP_ENCRYPTION_KEY',
].filter(name => process.env[name] && process.env[name].length < 32);
const urls = ['PUBLIC_STORAGE_BASE_URL', 'PUBLIC_API_BASE_URL', 'PUBLIC_APP_URL', 'PUBLIC_CONTRACT_APP_URL', 'PUBLIC_HELPDESK_API_BASE_URL'];
const insecure = urls.filter(name => { try { return new URL(process.env[name]).protocol !== 'https:'; } catch { return true; } });
try {
  if (new URL(process.env.PUBLIC_HELPDESK_WS_URL).protocol !== 'wss:') insecure.push('PUBLIC_HELPDESK_WS_URL');
} catch {
  insecure.push('PUBLIC_HELPDESK_WS_URL');
}
const cookieDomain = String(process.env.AUTH_COOKIE_DOMAIN || '').trim();
if (cookieDomain && (!cookieDomain.startsWith('.') || cookieDomain.includes('/') || cookieDomain.includes('localhost'))) insecure.push('AUTH_COOKIE_DOMAIN');
const origins = (process.env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
if (origins.some(origin => origin === '*' || !origin.startsWith('https://'))) insecure.push('ALLOWED_ORIGINS');
if (missing.length || weak.length || insecure.length) {
  console.error(JSON.stringify({ status: 'blocked', missing, weak, insecure: [...new Set(insecure)] }));
  process.exit(1);
}
console.log(JSON.stringify({ status: 'ready', checks: { required: required.length, https_urls: urls.length, wss_urls: 1, origins: origins.length } }));
