function hasUsableBounds(bounds) {
  return !!bounds &&
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 1 &&
    bounds.height > 1;
}

export function isPokerTableWindowEffectivelyVisible(
  win,
  { knownPokerClient = false } = {}
) {
  if (!win) return false;

  try {
    if (win.isWindow?.() === false) return false;
    if (win.isMinimized?.() === true) return false;
  } catch {
    return false;
  }

  let bounds;
  try {
    bounds = win.getBounds?.();
  } catch {
    return false;
  }
  if (!hasUsableBounds(bounds)) return false;

  let nativeVisibility;
  try {
    nativeVisibility = win.isVisible?.();
  } catch {
    return false;
  }

  // Client identity proves what owns the HWND, not whether it is on screen.
  return nativeVisibility === true;
}

export function hideOverlayWindows(entry) {
  for (const overlay of [entry?.bw, entry?.stakesBw, entry?.clockBw, entry?.frameBw]) {
    try { if (overlay && !overlay.isDestroyed?.()) overlay.hide(); } catch {}
  }
}

export { hasUsableBounds };
