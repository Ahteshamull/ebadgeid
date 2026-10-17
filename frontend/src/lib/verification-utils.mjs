// src/lib/verification-utils.mjs
//
// Centralized logic for verification URL resolution, preview detection,
// and credential status mapping. Extracted for direct unit testability.

/**
 * Builds the canonical public verification URL for a given credential code.
 * @param {string} credentialCode
 * @param {string} [origin='']
 * @returns {string}
 */
export function resolveVerificationUrl(credentialCode, origin = '') {
  const code = (credentialCode || '').toString().trim();
  const base = (origin || '').replace(/\/$/, '') || 'https://app.ebadgeid.com';
  return `${base}/verifications/credentials/${encodeURIComponent(code)}`;
}

/**
 * Checks whether the given credential code represents a template design preview.
 * @param {string} credentialCode
 * @returns {boolean}
 */
export function isPreviewCode(credentialCode) {
  return typeof credentialCode === 'string' && credentialCode.trim().toUpperCase() === 'PREVIEW';
}

/**
 * Computes the public verification status view for a credential.
 * Enforces zero exposure of sensitive PII.
 * @param {Object} options
 * @param {string} [options.status]
 * @param {string} [options.integrityStatus]
 * @param {boolean} [options.isPreview=false]
 * @returns {{ statusType: string, text: string, isAuthentic: boolean }}
 */
export function mapCredentialStatus({ status, integrityStatus, isPreview = false } = {}) {
  if (isPreview) {
    return { statusType: 'preview', text: 'Template Preview (Ready)', isAuthentic: true };
  }
  if (integrityStatus === 'failed') {
    return { statusType: 'integrity_failed', text: 'Integrity Check Failed', isAuthentic: false };
  }
  switch (status) {
    case 'Issued':
    case 'Claimed':
      return { statusType: 'valid', text: 'Verified', isAuthentic: true };
    case 'Expired':
      return { statusType: 'expired', text: 'Expired', isAuthentic: false };
    case 'Revoked':
      return { statusType: 'revoked', text: 'Revoked', isAuthentic: false };
    default:
      return { statusType: 'unknown', text: 'Unknown', isAuthentic: false };
  }
}
