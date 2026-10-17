import test from 'node:test';
import assert from 'node:assert/strict';
import { assignGroup, clampZoom, calculateFitZoom, reorderLayer, resolveEditorUploadUrl } from '../src/lib/editor-utils.mjs';

test('zoom remains inside the supported canvas range', () => {
  assert.equal(clampZoom(0.05), 0.1);
  assert.equal(clampZoom(2.5), 2.0);
  assert.equal(clampZoom(0.9), 0.9);
  assert.equal(clampZoom(0.25), 0.25);
});

test('calculateFitZoom calculates optimal zoom for high-res canvases', () => {
  // A 2400x3200 canvas on an 800x600 viewport should calculate around ~0.17 - 0.25
  const fitHighRes = calculateFitZoom({ w: 2400, h: 3200 }, 800, 600, 48);
  assert.ok(fitHighRes <= 0.35 && fitHighRes >= 0.1, `Fit zoom should fit viewport: ${fitHighRes}`);
  // A standard 900x636 canvas fits nicely around 0.8
  const fitStandard = calculateFitZoom({ w: 900, h: 636 }, 800, 600, 48);
  assert.ok(fitStandard <= 1.0 && fitStandard >= 0.7, `Fit standard canvas: ${fitStandard}`);
});

test('layer reordering moves only the selected element', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(reorderLayer(items, 'b', 1).map(item => item.id), ['a', 'c', 'b']);
  assert.deepEqual(items.map(item => item.id), ['a', 'b', 'c']);
});

test('group assignment preserves unselected elements', () => {
  const result = assignGroup([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['a', 'c'], 'g1');
  assert.equal(result[0].groupId, 'g1');
  assert.equal(result[1].groupId, undefined);
  assert.equal(result[2].groupId, 'g1');
});

test('resolveEditorUploadUrl handles relative paths, https upgrades, and empty values', () => {
  assert.equal(resolveEditorUploadUrl(''), '');
  assert.equal(resolveEditorUploadUrl(null), '');
  // Relative path resolution with base origin
  assert.equal(
    resolveEditorUploadUrl('/uploads/cert-bg.png', 'https://ebadgeid.onrender.com', true),
    'https://ebadgeid.onrender.com/uploads/cert-bg.png'
  );
  // Insecure http URL upgraded to https when isPageHttps is true
  assert.equal(
    resolveEditorUploadUrl('http://ebadgeid.onrender.com/uploads/sample.png', 'https://ebadgeid.onrender.com', true),
    'https://ebadgeid.onrender.com/uploads/sample.png'
  );
  // When not on https, http URL is preserved
  assert.equal(
    resolveEditorUploadUrl('http://localhost:5000/uploads/sample.png', 'http://localhost:5000', false),
    'http://localhost:5000/uploads/sample.png'
  );
  // https URL remains https
  assert.equal(
    resolveEditorUploadUrl('https://app.ebadgeid.com/uploads/sample.png', 'https://app.ebadgeid.com', true),
    'https://app.ebadgeid.com/uploads/sample.png'
  );
});

