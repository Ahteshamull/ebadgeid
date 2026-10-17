/**
 * Validation utilities for contract document and attachment uploads.
 * Backend enforces a 10 MB limit and supports PDF / images.
 */

export const MAX_CONTRACT_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_CONTRACT_DOCUMENT_EXTENSIONS = ['.pdf'];
export const ALLOWED_ATTACHMENT_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.svg'];

/**
 * Validates a contract primary document file.
 * Must be a PDF and <= 10 MB.
 *
 * @param {File|Object} file - Browser File or file-like object
 * @returns {{ valid: boolean, error?: string }} Validation result
 */
export function validateContractDocumentFile(file) {
  if (!file) {
    return { valid: false, error: 'Please select a contract document.' };
  }

  if (typeof file.size === 'number' && file.size > MAX_CONTRACT_FILE_SIZE) {
    const sizeInMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File size exceeds the 10 MB limit (${sizeInMb} MB). Please select a smaller PDF.`
    };
  }

  const name = typeof file.name === 'string' ? file.name.trim() : '';
  const lowerName = name.toLowerCase();
  const isPdfExt = lowerName.endsWith('.pdf');
  const isPdfMime = file.type === 'application/pdf';

  if (!isPdfExt && (!file.type || !isPdfMime)) {
    return {
      valid: false,
      error: 'Invalid file format. Contract documents must be in PDF format.'
    };
  }

  return { valid: true };
}

/**
 * Validates an attachment file.
 * Must be <= 10 MB and have an allowed document/image format.
 *
 * @param {File|Object} file - Browser File or file-like object
 * @returns {{ valid: boolean, error?: string }} Validation result
 */
export function validateAttachmentFile(file) {
  if (!file) {
    return { valid: false, error: 'Please select a file to attach.' };
  }

  if (typeof file.size === 'number' && file.size > MAX_CONTRACT_FILE_SIZE) {
    const fileName = file.name ? `"${file.name}" ` : '';
    return {
      valid: false,
      error: `${fileName}exceeds the 10 MB limit. Please select a smaller file.`
    };
  }

  const name = typeof file.name === 'string' ? file.name.trim() : '';
  const lowerName = name.toLowerCase();
  const hasValidExt = ALLOWED_ATTACHMENT_EXTENSIONS.some(ext => lowerName.endsWith(ext));

  if (!hasValidExt) {
    const fileName = file.name ? `"${file.name}" ` : '';
    return {
      valid: false,
      error: `${fileName}has an unsupported format. Allowed: PDF, PNG, JPG, WEBP, SVG.`
    };
  }

  return { valid: true };
}
