export const clampZoom = value => Math.max(0.4, Math.min(1.5, Number(value)));

export function reorderLayer(elements, id, direction) {
  const next = [...elements];
  const index = next.findIndex(item => item.id === id);
  if (index < 0) return elements;
  const target = Math.max(0, Math.min(next.length - 1, index + direction));
  if (target === index) return elements;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function assignGroup(elements, selectedIds, groupId = null) {
  return elements.map(item => selectedIds.includes(item.id) ? { ...item, groupId } : item);
}
