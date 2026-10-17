// src/lib/asset-upload-utils.mjs
//
// Client-side validation and formatting for graphic assets uploaded to
// the design editor library. Extracted for direct unit testability.

export const MAX_ASSET_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_ASSET_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);

export const ALLOWED_ASSET_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.svg',
]);

/**
 * Validates file type and size before initiating network upload.
 * @param {File|{ name: string, size: number, type?: string }} file
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateAssetFile(file) {
  if (!file) {
    return { valid: false, error: 'No file selected. Please choose an image to upload.' };
  }

  // Check file size (max 10 MB)
  if (typeof file.size === 'number' && file.size > MAX_ASSET_FILE_SIZE) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File is too large (${sizeMb} MB). Maximum allowed size is 10 MB.`,
    };
  }

  // Check file extension
  const fileName = file.name || '';
  const extMatch = fileName.match(/\.[^.]+$/);
  const ext = extMatch ? extMatch[0].toLowerCase() : '';

  const mime = (file.type || '').toLowerCase();
  const hasValidMime = mime ? ALLOWED_ASSET_MIME_TYPES.has(mime) : false;
  const hasValidExt = ext ? ALLOWED_ASSET_EXTENSIONS.has(ext) : false;

  if (!hasValidMime && !hasValidExt) {
    return {
      valid: false,
      error: 'Unsupported file format. Please upload PNG, JPG, WEBP, or SVG images.',
    };
  }

  return { valid: true };
}

/**
 * Derives a human-friendly default name for an asset from its filename.
 * @param {string} filename
 * @returns {string}
 */
export function cleanAssetName(filename) {
  if (!filename || typeof filename !== 'string') return 'Asset';
  const withoutExt = filename.replace(/\.[^.]+$/, '').trim();
  const sanitized = withoutExt
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized.slice(0, 80) || 'Asset';
}
