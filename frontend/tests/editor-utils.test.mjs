import test from 'node:test';
import assert from 'node:assert/strict';
import { assignGroup, clampZoom, reorderLayer, resolveEditorUploadUrl } from '../src/lib/editor-utils.mjs';

test('zoom remains inside the supported canvas range', () => {
  assert.equal(clampZoom(0.1), 0.4);
  assert.equal(clampZoom(2), 1.5);
  assert.equal(clampZoom(0.9), 0.9);
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

