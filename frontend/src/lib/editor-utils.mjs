export const clampZoom = (value, min = 0.1, max = 2.0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.8;
  return Math.max(min, Math.min(max, Math.round(num * 100) / 100));
};

export function calculateFitZoom(canvasSize, containerWidth = 800, containerHeight = 600, padding = 48) {
  if (!canvasSize || !canvasSize.w || !canvasSize.h) return 0.8;
  const availW = Math.max(160, containerWidth - padding);
  const availH = Math.max(160, containerHeight - padding);
  const zoomW = availW / canvasSize.w;
  const zoomH = availH / canvasSize.h;
  const fit = Math.min(zoomW, zoomH, 1.0);
  return clampZoom(fit, 0.1, 2.0);
}

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

export function resolveEditorUploadUrl(url, baseOrigin = '', isPageHttps = false) {
  if (!url) return '';
  let resolved = String(url).trim();
  if (!/^https?:\/\//i.test(resolved)) {
    const origin = baseOrigin ? baseOrigin.replace(/\/$/, '') : '';
    resolved = `${origin}${resolved.startsWith('/') ? '' : '/'}${resolved}`;
  }
  if (isPageHttps && resolved.startsWith('http://')) {
    resolved = resolved.replace(/^http:\/\//i, 'https://');
  }
  return resolved;
}

