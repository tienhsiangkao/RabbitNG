const DEFAULT_BOUNDS_TOLERANCE_PX = 12;

function normalizedTitle(win) {
  try {
    return String(win?.getTitle?.() || win?.title || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  } catch {
    return "";
  }
}

function normalizedBounds(win) {
  try {
    const bounds = win?.getBounds?.();
    if (!bounds) return null;
    const x = Math.round(Number(bounds.x));
    const y = Math.round(Number(bounds.y));
    const width = Math.round(Number(bounds.width));
    const height = Math.round(Number(bounds.height));
    if (![x, y, width, height].every(Number.isFinite)) return null;
    return { x, y, width, height };
  } catch {
    return null;
  }
}

export function tableWindowIdentity(win) {
  const title = normalizedTitle(win);
  const bounds = normalizedBounds(win);
  if (!title || !bounds) return null;
  return `${title}|${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
}

function boundsWithinTolerance(a, b, tolerancePx) {
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) <= tolerancePx &&
    Math.abs(a.y - b.y) <= tolerancePx &&
    Math.abs(a.width - b.width) <= tolerancePx &&
    Math.abs(a.height - b.height) <= tolerancePx
  );
}

export function samePhysicalTable(a, b, tolerancePx = DEFAULT_BOUNDS_TOLERANCE_PX) {
  const titleA = normalizedTitle(a);
  const titleB = normalizedTitle(b);
  if (!titleA || !titleB || titleA !== titleB) return false;

  const boundsA = normalizedBounds(a);
  const boundsB = normalizedBounds(b);
  const tolerance = Math.max(0, Number(tolerancePx) || 0);
  return boundsWithinTolerance(boundsA, boundsB, tolerance);
}

export function dedupeTableWindows(windows, preferredIds = new Set(), options = {}) {
  const unique = [];
  const duplicateIds = [];
  const canonicalIdById = new Map();
  const groups = [];
  const tolerancePx = Number.isFinite(options.boundsTolerancePx)
    ? Math.max(0, options.boundsTolerancePx)
    : DEFAULT_BOUNDS_TOLERANCE_PX;

  for (const win of windows || []) {
    let matchingGroup = null;
    for (const group of groups) {
      if (samePhysicalTable(group[0], win, tolerancePx)) {
        matchingGroup = group;
        break;
      }
    }

    if (matchingGroup) {
      matchingGroup.push(win);
      continue;
    }

    groups.push([win]);
  }

  for (const group of groups) {
    const preferred = group.find((win) => preferredIds.has(win.id));
    const kept = preferred || group[0];
    unique.push(kept);
    if (typeof kept?.id === "number") {
      canonicalIdById.set(kept.id, kept.id);
    }
    for (const win of group) {
      if (typeof win?.id === "number" && typeof kept?.id === "number") {
        canonicalIdById.set(win.id, kept.id);
      }
      if (win !== kept && typeof win?.id === "number") {
        duplicateIds.push(win.id);
      }
    }
  }

  return { windows: unique, duplicateIds, canonicalIdById };
}
