import test from 'node:test';
import assert from 'node:assert/strict';
import { assignGroup, clampZoom, reorderLayer } from '../src/lib/editor-utils.mjs';

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
