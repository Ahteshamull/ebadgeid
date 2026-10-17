/**
 * Validation utilities for profile picture and company logo/branding uploads.
 * Restricts profile photos to PNG, JPEG, and WEBP formats with a max file size of 5 MB.
 * Allows company logos in PNG, JPEG, WEBP, and SVG formats up to 5 MB.
 */

export const MAX_PROFILE_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
export const MAX_LOGO_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB

export const ALLOWED_PROFILE_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp'
]);

export const ALLOWED_PROFILE_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp'
]);

export const ALLOWED_LOGO_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml'
]);

export const ALLOWED_LOGO_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.svg'
]);

/**
 * Validates a profile photo candidate file.
 *
 * @param {File|{ name: string, size: number, type?: string }} file
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateProfileImageFile(file) {
  if (!file) {
    return { valid: false, error: 'No file selected. Please choose a profile picture.' };
  }

  if (typeof file.size === 'number' && file.size > MAX_PROFILE_IMAGE_SIZE) {
    const sizeInMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File size (${sizeInMb} MB) exceeds the 5 MB limit. Please choose a smaller image.`
    };
  }

  const filename = file.name || '';
  const extMatch = filename.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '';

  const mime = (file.type || '').toLowerCase();

  // If MIME is provided and recognizable, check it
  if (mime && !ALLOWED_PROFILE_IMAGE_MIME.has(mime)) {
    return {
      valid: false,
      error: 'Unsupported file format. Please upload a PNG, JPEG, or WEBP image.'
    };
  }

  // If extension is not in the allowed list, reject
  if (ext && !ALLOWED_PROFILE_IMAGE_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: 'Unsupported file format. Please upload a PNG, JPEG, or WEBP image.'
    };
  }

  // If neither extension nor mime was present
  if (!mime && !ext) {
    return {
      valid: false,
      error: 'Could not determine image format. Please upload a valid PNG, JPEG, or WEBP image.'
    };
  }

  return { valid: true };
}

/**
 * Validates a company logo or signature image candidate file.
 *
 * @param {File|{ name: string, size: number, type?: string }} file
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateCompanyLogoFile(file) {
  if (!file) {
    return { valid: false, error: 'No file selected. Please choose a company logo.' };
  }

  if (typeof file.size === 'number' && file.size > MAX_LOGO_IMAGE_SIZE) {
    const sizeInMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `Logo file size (${sizeInMb} MB) exceeds the 5 MB limit. Please choose a smaller image.`
    };
  }

  const filename = file.name || '';
  const extMatch = filename.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '';

  const mime = (file.type || '').toLowerCase();

  // If MIME is provided and recognizable, check it
  if (mime && !ALLOWED_LOGO_IMAGE_MIME.has(mime)) {
    return {
      valid: false,
      error: 'Unsupported file format. Please upload a PNG, JPEG, WEBP, or SVG logo.'
    };
  }

  // If extension is not in the allowed list, reject
  if (ext && !ALLOWED_LOGO_IMAGE_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: 'Unsupported file format. Please upload a PNG, JPEG, WEBP, or SVG logo.'
    };
  }

  // If neither extension nor mime was present
  if (!mime && !ext) {
    return {
      valid: false,
      error: 'Could not determine image format. Please upload a valid PNG, JPEG, WEBP, or SVG logo.'
    };
  }

  return { valid: true };
}

/**
 * Validates a digital signature image candidate file.
 *
 * @param {File|{ name: string, size: number, type?: string }} file
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateSignatureFile(file) {
  if (!file) {
    return { valid: false, error: 'No file selected. Please choose a signature image.' };
  }

  if (typeof file.size === 'number' && file.size > MAX_LOGO_IMAGE_SIZE) {
    const sizeInMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `Signature file size (${sizeInMb} MB) exceeds the 5 MB limit. Please choose a smaller image.`
    };
  }

  const filename = file.name || '';
  const extMatch = filename.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '';

  const mime = (file.type || '').toLowerCase();

  // If MIME is provided and recognizable, check it
  if (mime && !ALLOWED_LOGO_IMAGE_MIME.has(mime)) {
    return {
      valid: false,
      error: 'Unsupported file format. Please upload a PNG, JPEG, WEBP, or SVG signature.'
    };
  }

  // If extension is not in the allowed list, reject
  if (ext && !ALLOWED_LOGO_IMAGE_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: 'Unsupported file format. Please upload a PNG, JPEG, WEBP, or SVG signature.'
    };
  }

  // If neither extension nor mime was present
  if (!mime && !ext) {
    return {
      valid: false,
      error: 'Could not determine signature image format. Please upload a valid PNG, JPEG, WEBP, or SVG image.'
    };
  }

  return { valid: true };
}
