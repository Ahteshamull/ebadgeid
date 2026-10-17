import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAssetFile, cleanAssetName, MAX_ASSET_FILE_SIZE } from '../src/lib/asset-upload-utils.mjs';

test('validateAssetFile rejects null or missing file', () => {
  const result = validateAssetFile(null);
  assert.equal(result.valid, false);
  assert.match(result.error, /No file selected/i);
});

test('validateAssetFile rejects files exceeding 10 MB limit', () => {
  const oversizedFile = {
    name: 'giant-photo.png',
    size: MAX_ASSET_FILE_SIZE + 1024,
    type: 'image/png',
  };
  const result = validateAssetFile(oversizedFile);
  assert.equal(result.valid, false);
  assert.match(result.error, /File is too large/i);
  assert.match(result.error, /10 MB/);
});

test('validateAssetFile accepts valid PNG, JPEG, WEBP, and SVG files under limit', () => {
  const validFiles = [
    { name: 'logo.png', size: 1024 * 500, type: 'image/png' },
    { name: 'banner.jpg', size: 1024 * 1024, type: 'image/jpeg' },
    { name: 'badge.webp', size: 1024 * 200, type: 'image/webp' },
    { name: 'icon.svg', size: 1024 * 50, type: 'image/svg+xml' },
  ];
  for (const file of validFiles) {
    const result = validateAssetFile(file);
    assert.equal(result.valid, true, `Expected ${file.name} to be valid`);
  }
});

test('validateAssetFile rejects disallowed file extensions', () => {
  const invalidFiles = [
    { name: 'document.pdf', size: 1024 * 100, type: 'application/pdf' },
    { name: 'script.exe', size: 1024 * 100, type: 'application/x-msdownload' },
    { name: 'video.mp4', size: 1024 * 100, type: 'video/mp4' },
    { name: 'font.ttf', size: 1024 * 100, type: 'font/ttf' },
  ];
  for (const file of invalidFiles) {
    const result = validateAssetFile(file);
    assert.equal(result.valid, false, `Expected ${file.name} to be rejected`);
    assert.match(result.error, /Unsupported file format/i);
  }
});

test('cleanAssetName creates human-readable title from filename', () => {
  assert.equal(
    cleanAssetName('pngtree-abstract-cloudy-background-beautiful.png'),
    'pngtree abstract cloudy background beautiful'
  );
  assert.equal(
    cleanAssetName('company_official_gold_seal_2026.svg'),
    'company official gold seal 2026'
  );
  assert.equal(cleanAssetName(''), 'Asset');
  assert.equal(cleanAssetName(null), 'Asset');
});
