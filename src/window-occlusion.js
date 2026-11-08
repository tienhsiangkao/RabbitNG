import { isPokerTableWindowEffectivelyVisible } from './window-visibility.js';

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function findVisibleOverlayRect(table, preferred, blockers) {
  const maxX = table.x + table.width - preferred.width, maxY = table.y + table.height - preferred.height;
  if (maxX < table.x || maxY < table.y) return null;
  const anchored = { ...preferred, x: Math.round(Math.max(table.x, Math.min(maxX, preferred.x))),
    y: Math.round(Math.max(table.y, Math.min(maxY, preferred.y))) };
  return blockers.some((bounds) => overlaps(bounds, anchored)) ? null : anchored;
}

export function computeOverlayPlacement(windows, { ignoreIds = new Set(), canonicalIdById = new Map(), getBounds, getOverlayRect, getDisplayState = () => ({}) }) {
  const result = new Map(), placements = new Map(), blockersById = new Map(), above = [];
  for (const win of windows || []) {
    if (ignoreIds.has(String(win.id))) continue;
    if (!isPokerTableWindowEffectivelyVisible(win)) { result.set(win.id, true); continue; }
    try {
      const state = getDisplayState(win);
      if (state.cloaked || state.shellSurface) { result.set(win.id, true); continue; }
      const bounds = getBounds(win), overlay = getOverlayRect(bounds);
      const identity = canonicalIdById.get(win.id) ?? win.id;
      const blockers = above.filter((other) => other.identity !== identity).map((other) => other.bounds);
      blockersById.set(win.id, blockers);
      const placement = findVisibleOverlayRect(bounds, overlay, blockers);
      result.set(win.id, placement === null);
      if (placement) placements.set(win.id, placement);
      above.push({ bounds, identity });
    } catch { result.set(win.id, true); }
  }
  return { occluded: result, placements, blockersById };
}

export function computeWindowOcclusion(windows, options) {
  return computeOverlayPlacement(windows, options).occluded;
}

export function nativeBoundsToDip(win, convertRect) {
  const bounds = win.getBounds();
  const factor = win.getMonitor?.()?.getScaleFactor?.() ?? 1;
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('Invalid window scale');
  const physical = Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, Math.round(bounds[key] * factor)]));
  return convertRect(physical);
}
