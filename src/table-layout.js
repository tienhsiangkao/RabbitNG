const MAX_GRID_DIMENSION = 12;
const MAX_GAP = 96;
const MAX_MARGIN = 160;

export const DEFAULT_LAYOUT_PROFILE = Object.freeze({
  id: "default",
  name: "Default",
  monitorId: "primary",
  rows: 0,
  columns: 0,
  gap: 0,
  margin: 0
});

export const DEFAULT_TABLE_LAYOUT_SETTINGS = Object.freeze({
  enabled: true,
  autoArrange: true,
  lockLayout: false,
  arrangeOnStartup: true,
  restoreOnStop: false,
  activeProfileId: DEFAULT_LAYOUT_PROFILE.id,
  hotkey: "Ctrl+Alt+T",
  profiles: [DEFAULT_LAYOUT_PROFILE]
});

function finiteInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cleanText(value, fallback, maxLength = 40) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return (text || fallback).slice(0, maxLength);
}

function cleanProfileId(value, fallback = "layout") {
  const id = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return id || fallback;
}

export function normalizeLayoutProfile(profile = {}, fallback = {}) {
  const defaults = {
    ...DEFAULT_LAYOUT_PROFILE,
    ...fallback
  };

  return {
    id: cleanProfileId(profile.id, cleanProfileId(defaults.id, "layout")),
    name: cleanText(profile.name, defaults.name),
    monitorId: cleanText(profile.monitorId, defaults.monitorId, 80),
    rows: clamp(finiteInteger(profile.rows, defaults.rows), 0, MAX_GRID_DIMENSION),
    columns: clamp(finiteInteger(profile.columns, defaults.columns), 0, MAX_GRID_DIMENSION),
    gap: clamp(finiteInteger(profile.gap, defaults.gap), 0, MAX_GAP),
    margin: clamp(finiteInteger(profile.margin, defaults.margin), 0, MAX_MARGIN)
  };
}

export function normalizeTableLayoutSettings(value = {}) {
  const rawProfiles = Array.isArray(value?.profiles) && value.profiles.length > 0
    ? value.profiles
    : DEFAULT_TABLE_LAYOUT_SETTINGS.profiles;
  const profiles = [];
  const usedIds = new Set();

  for (let index = 0; index < rawProfiles.length; index++) {
    const normalized = normalizeLayoutProfile(rawProfiles[index], {
      id: index === 0 ? "default" : `layout-${index + 1}`,
      name: index === 0 ? "Default" : `Layout ${index + 1}`
    });
    let id = normalized.id;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${normalized.id}-${suffix++}`;
    }
    usedIds.add(id);
    profiles.push({ ...normalized, id });
  }

  const requestedActiveId = cleanProfileId(value?.activeProfileId, profiles[0].id);
  const activeProfileId = profiles.some((profile) => profile.id === requestedActiveId)
    ? requestedActiveId
    : profiles[0].id;

  return {
    enabled: value?.enabled !== false,
    autoArrange: value?.autoArrange !== false,
    lockLayout: value?.lockLayout === true,
    arrangeOnStartup: value?.arrangeOnStartup !== false,
    restoreOnStop: value?.restoreOnStop === true,
    activeProfileId,
    hotkey: cleanText(value?.hotkey, DEFAULT_TABLE_LAYOUT_SETTINGS.hotkey, 40),
    profiles
  };
}

export function getActiveLayoutProfile(config) {
  const normalized = normalizeTableLayoutSettings(config);
  return normalized.profiles.find((profile) => profile.id === normalized.activeProfileId)
    || normalized.profiles[0];
}

export function createLayoutProfile(config, requestedName = "New layout") {
  const normalized = normalizeTableLayoutSettings(config);
  const baseName = cleanText(requestedName, "New layout");
  const baseId = cleanProfileId(baseName, "layout");
  const usedIds = new Set(normalized.profiles.map((profile) => profile.id));
  let id = baseId;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${suffix++}`;
  }

  const source = getActiveLayoutProfile(normalized);
  const profile = normalizeLayoutProfile({
    ...source,
    id,
    name: baseName
  });

  return normalizeTableLayoutSettings({
    ...normalized,
    activeProfileId: profile.id,
    profiles: [...normalized.profiles, profile]
  });
}

export function upsertLayoutProfile(config, profilePatch = {}) {
  const normalized = normalizeTableLayoutSettings(config);
  const requestedId = cleanProfileId(
    profilePatch.id,
    normalized.activeProfileId
  );
  const existingIndex = normalized.profiles.findIndex((profile) => profile.id === requestedId);
  const source = existingIndex >= 0
    ? normalized.profiles[existingIndex]
    : getActiveLayoutProfile(normalized);
  const nextProfile = normalizeLayoutProfile({
    ...source,
    ...profilePatch,
    id: requestedId
  });
  const profiles = [...normalized.profiles];

  if (existingIndex >= 0) {
    profiles[existingIndex] = nextProfile;
  } else {
    profiles.push(nextProfile);
  }

  return normalizeTableLayoutSettings({
    ...normalized,
    activeProfileId: nextProfile.id,
    profiles
  });
}

export function deleteLayoutProfile(config, profileId) {
  const normalized = normalizeTableLayoutSettings(config);
  if (normalized.profiles.length <= 1) return normalized;

  const requestedId = cleanProfileId(profileId, "");
  const profiles = normalized.profiles.filter((profile) => profile.id !== requestedId);
  if (profiles.length === normalized.profiles.length) return normalized;

  const activeProfileId = normalized.activeProfileId === requestedId
    ? profiles[0].id
    : normalized.activeProfileId;

  return normalizeTableLayoutSettings({
    ...normalized,
    activeProfileId,
    profiles
  });
}

function resolveGrid(tableCount, profile) {
  let rows = clamp(finiteInteger(profile?.rows, 0), 0, MAX_GRID_DIMENSION);
  let columns = clamp(finiteInteger(profile?.columns, 0), 0, MAX_GRID_DIMENSION);

  if (rows === 0 && columns === 0) {
    columns = Math.max(1, Math.ceil(Math.sqrt(tableCount)));
    rows = Math.max(1, Math.ceil(tableCount / columns));
  } else if (rows === 0) {
    rows = Math.max(1, Math.ceil(tableCount / columns));
  } else if (columns === 0) {
    columns = Math.max(1, Math.ceil(tableCount / rows));
  } else if (rows * columns < tableCount) {
    rows = Math.ceil(tableCount / columns);
  }

  return { rows, columns };
}

function partitionSize(total, count, index) {
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return base + (index < remainder ? 1 : 0);
}

function partitionOffset(total, count, index) {
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return index * base + Math.min(index, remainder);
}

export function calculateTileRects(workArea, tableCount, profile = {}, {columnFirst=false,tableAspectRatio,profileScale=1} = {}) {
  const count = Math.max(0, finiteInteger(tableCount, 0));
  if (count === 0) return [];

  const x = finiteInteger(workArea?.x, 0);
  const y = finiteInteger(workArea?.y, 0);
  const width = Math.max(1, finiteInteger(workArea?.width, 1));
  const height = Math.max(1, finiteInteger(workArea?.height, 1));
  const normalizedProfile = normalizeLayoutProfile(profile);
  const scale=Number.isFinite(profileScale)&&profileScale>0?profileScale:1;
  const { rows, columns } = resolveGrid(count, normalizedProfile);
  const maxMargin = Math.max(0, Math.floor((Math.min(width, height) - 1) / 2));
  const margin = Math.min(Math.round(normalizedProfile.margin*scale), maxMargin);
  const availableWidth = Math.max(1, width - margin * 2);
  const availableHeight = Math.max(1, height - margin * 2);
  const horizontalGap = Math.min(
    Math.round(normalizedProfile.gap*scale),
    columns > 1 ? Math.floor((availableWidth - 1) / (columns - 1)) : 0
  );
  const verticalGap = Math.min(
    Math.round(normalizedProfile.gap*scale),
    rows > 1 ? Math.floor((availableHeight - 1) / (rows - 1)) : 0
  );
  let cellSpaceWidth = Math.max(1, availableWidth - horizontalGap * (columns - 1));
  let cellSpaceHeight = Math.max(1, availableHeight - verticalGap * (rows - 1));
  // Fit one compact proportional grid inside the work area. Extra room stays
  // outside the table windows, instead of becoming GG's internal black bars.
  if (Number.isFinite(tableAspectRatio) && tableAspectRatio > 0) {
    const cellWidth=Math.max(1,Math.floor(cellSpaceWidth/columns));
    const cellHeight=Math.max(1,Math.floor(cellSpaceHeight/rows));
    if(cellWidth/cellHeight>tableAspectRatio) {
      cellSpaceWidth=Math.max(1,Math.floor(cellHeight*tableAspectRatio))*columns;
      cellSpaceHeight=cellHeight*rows;
    } else {
      cellSpaceWidth=cellWidth*columns;
      cellSpaceHeight=Math.max(1,Math.floor(cellWidth/tableAspectRatio))*rows;
    }
  }
  const rects = [];

  for (let index = 0; index < count; index++) {
    const row = columnFirst ? index % rows : Math.floor(index / columns);
    const column = columnFirst ? Math.floor(index / rows) : index % columns;
    const cellWidth = Math.max(1, partitionSize(cellSpaceWidth, columns, column));
    const cellHeight = Math.max(1, partitionSize(cellSpaceHeight, rows, row));
    rects.push({
      x: x + margin + partitionOffset(cellSpaceWidth, columns, column) + horizontalGap * column,
      y: y + margin + partitionOffset(cellSpaceHeight, rows, row) + verticalGap * row,
      width: cellWidth,
      height: cellHeight
    });
  }

  return rects;
}

export function boundsApproximatelyEqual(a, b, tolerance = 2) {
  if (!a || !b) return false;
  const allowed = Math.max(0, finiteInteger(tolerance, 0));
  return (
    Math.abs(Number(a.x) - Number(b.x)) <= allowed &&
    Math.abs(Number(a.y) - Number(b.y)) <= allowed &&
    Math.abs(Number(a.width) - Number(b.width)) <= allowed &&
    Math.abs(Number(a.height) - Number(b.height)) <= allowed
  );
}
