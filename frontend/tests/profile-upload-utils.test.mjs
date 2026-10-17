import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProfileImageFile,
  validateCompanyLogoFile,
  validateSignatureFile,
  MAX_PROFILE_IMAGE_SIZE,
  MAX_LOGO_IMAGE_SIZE
} from '../src/lib/profile-upload-utils.mjs';

test('validateProfileImageFile: rejects null or missing file', () => {
  assert.equal(validateProfileImageFile(null).valid, false);
  assert.equal(validateProfileImageFile(undefined).valid, false);
  assert.match(validateProfileImageFile(null).error, /No file selected/);
});

test('validateProfileImageFile: rejects files exceeding 5 MB limit', () => {
  const oversizeFile = {
    name: 'avatar.png',
    size: MAX_PROFILE_IMAGE_SIZE + 1024,
    type: 'image/png'
  };
  const result = validateProfileImageFile(oversizeFile);
  assert.equal(result.valid, false);
  assert.match(result.error, /exceeds the 5 MB limit/);
});

test('validateProfileImageFile: accepts valid PNG, JPEG, and WEBP under limit', () => {
  const validFiles = [
    { name: 'profile.png', size: 1024 * 500, type: 'image/png' },
    { name: 'photo.jpg', size: 1024 * 1024 * 2, type: 'image/jpeg' },
    { name: 'headshot.jpeg', size: 1024 * 800, type: 'image/jpeg' },
    { name: 'avatar.webp', size: 1024 * 300, type: 'image/webp' },
  ];

  for (const file of validFiles) {
    const result = validateProfileImageFile(file);
    assert.equal(result.valid, true, `Expected ${file.name} to be valid`);
  }
});

test('validateProfileImageFile: rejects GIF, SVG, and other unsupported file types', () => {
  const disallowed = [
    { name: 'animation.gif', size: 1024 * 100, type: 'image/gif' },
    { name: 'vector.svg', size: 1024 * 50, type: 'image/svg+xml' },
    { name: 'document.pdf', size: 1024 * 200, type: 'application/pdf' },
    { name: 'script.exe', size: 1024 * 500, type: 'application/octet-stream' },
  ];

  for (const file of disallowed) {
    const result = validateProfileImageFile(file);
    assert.equal(result.valid, false, `Expected ${file.name} to be rejected`);
    assert.match(result.error, /Unsupported file format/);
  }
});

test('validateCompanyLogoFile: accepts PNG, JPEG, WEBP, and SVG logo files', () => {
  const validLogos = [
    { name: 'company-logo.png', size: 1024 * 500, type: 'image/png' },
    { name: 'logo.jpg', size: 1024 * 1024, type: 'image/jpeg' },
    { name: 'brand.webp', size: 1024 * 200, type: 'image/webp' },
    { name: 'vector-badge.svg', size: 1024 * 50, type: 'image/svg+xml' },
  ];

  for (const file of validLogos) {
    const result = validateCompanyLogoFile(file);
    assert.equal(result.valid, true, `Expected ${file.name} to be valid`);
  }
});

test('validateCompanyLogoFile: rejects oversize logos exceeding 5 MB limit', () => {
  const oversize = {
    name: 'giant-logo.png',
    size: MAX_LOGO_IMAGE_SIZE + 2048,
    type: 'image/png'
  };
  const result = validateCompanyLogoFile(oversize);
  assert.equal(result.valid, false);
  assert.match(result.error, /exceeds the 5 MB limit/);
});

test('validateCompanyLogoFile: rejects unsupported types like GIF, PDF, and EXE', () => {
  const disallowed = [
    { name: 'spinner.gif', size: 1024 * 50, type: 'image/gif' },
    { name: 'contract.pdf', size: 1024 * 100, type: 'application/pdf' },
  ];

  for (const file of disallowed) {
    const result = validateCompanyLogoFile(file);
    assert.equal(result.valid, false);
    assert.match(result.error, /Unsupported file format/);
  }
});

test('validateSignatureFile: accepts valid PNG, JPEG, WEBP, and SVG signature files', () => {
  const validSignatures = [
    { name: 'signature.png', size: 1024 * 150, type: 'image/png' },
    { name: 'sig.jpg', size: 1024 * 200, type: 'image/jpeg' },
    { name: 'sig.webp', size: 1024 * 120, type: 'image/webp' },
    { name: 'signature.svg', size: 1024 * 30, type: 'image/svg+xml' },
  ];

  for (const file of validSignatures) {
    const result = validateSignatureFile(file);
    assert.equal(result.valid, true, `Expected ${file.name} to be valid`);
  }
});

test('validateSignatureFile: rejects null, oversize, or unsupported types', () => {
  assert.equal(validateSignatureFile(null).valid, false);
  assert.match(validateSignatureFile(null).error, /No file selected/);

  const oversize = {
    name: 'giant-signature.png',
    size: MAX_LOGO_IMAGE_SIZE + 5000,
    type: 'image/png'
  };
  assert.equal(validateSignatureFile(oversize).valid, false);
  assert.match(validateSignatureFile(oversize).error, /exceeds the 5 MB limit/);

  const disallowed = {
    name: 'signature.pdf',
    size: 1024 * 100,
    type: 'application/pdf'
  };
  assert.equal(validateSignatureFile(disallowed).valid, false);
  assert.match(validateSignatureFile(disallowed).error, /Unsupported file format/);
});
