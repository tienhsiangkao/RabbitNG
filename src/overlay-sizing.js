function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positiveNumber(value, fallback) {
  const n = finiteNumber(value, fallback);
  return n > 0 ? n : fallback;
}

export function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeRngSizing(config = {}) {
  if (config.scalingVersion === 5) return { ...config };
  return { ...config, sizeMode: 'proportional', basePctSmall: .075,
    minW: 40, minH: 30, maxW: 360, maxH: 270, scalingVersion: 5,
    anchor: { xPct: .343, yPct: .72 }, position: { ...config.position, mode: 'hero-hand' } };
}

export function rngOverlaySize(overlayConfig = {}, tableBounds = {}, appearance = {}) {
  const minW = Math.round(positiveNumber(overlayConfig.minW, 40));
  const minH = Math.round(positiveNumber(overlayConfig.minH, 30));
  const mode = String(overlayConfig.sizeMode || overlayConfig.sizingMode || "proportional").toLowerCase();

  let rawW;
  let rawH;

  if (mode === "proportional") {
    const basePctSmall = positiveNumber(overlayConfig.basePctSmall, 0.075);
    const tableWidth = positiveNumber(tableBounds.width, 1000);
    const tableHeight = positiveNumber(tableBounds.height, 700);
    const baseSize = Math.sqrt(tableWidth * tableHeight) * basePctSmall;
    rawW = Math.floor(baseSize * 1.2);
    rawH = Math.floor(baseSize * 0.9);
  } else {
    rawW = positiveNumber(overlayConfig.fixedW ?? overlayConfig.targetW, minW);
    rawH = positiveNumber(overlayConfig.fixedH ?? overlayConfig.targetH, minH);
  }

  const scale=clampNumber(positiveNumber(appearance.rngScale,1),.6,1.6);
  rawW *= scale; rawH *= scale;
  const maxW = positiveNumber(overlayConfig.maxW, mode === 'proportional' ? 360 : Math.max(minW, rawW));
  const maxH = positiveNumber(overlayConfig.maxH, mode === 'proportional' ? 270 : Math.max(minH, rawH));
  const tableMaxPctW = positiveNumber(overlayConfig.maxTablePctW, 0.22);
  const tableMaxPctH = positiveNumber(overlayConfig.maxTablePctH, 0.18);
  const tableMaxW = Math.max(minW, Math.floor(positiveNumber(tableBounds.width, maxW / tableMaxPctW) * tableMaxPctW));
  const tableMaxH = Math.max(minH, Math.floor(positiveNumber(tableBounds.height, maxH / tableMaxPctH) * tableMaxPctH));

  const upperW = Math.max(minW, Math.min(maxW, tableMaxW));
  const upperH = Math.max(minH, Math.min(maxH, tableMaxH));

  return {
    width: Math.round(clampNumber(rawW, minW, upperW)),
    height: Math.round(clampNumber(rawH, minH, upperH))
  };
}

export function heroHandOverlayRect(config = {}, table = {}, appearance = {}) {
  const size = rngOverlaySize(config, table, appearance);
  const width = positiveNumber(table.width, 1000), height = positiveNumber(table.height, 700);
  // GG's bottom-center hand starts near 43% of table width. Anchor the
  // panel's right edge, so resizing preserves the gap rather than drifting.
  const gap=clampNumber(finiteNumber(appearance.rngGap,.012),.005,.05);
  return { x: Math.round(finiteNumber(table.x, 0) + width * (.43 - gap) - size.width),
    y: Math.round(finiteNumber(table.y, 0) + height * .76 - size.height / 2), ...size };
}

export function auxiliaryOverlayLayout(table, rush = false) {
  const unit = Math.sqrt(table.width * table.height);
  const clockFont = Math.max(12, Math.round(unit * .036));
  const stakesFont = Math.max(9, Math.round(unit * .024));
  const stakesPanelHeight=Math.max(28,Math.ceil(stakesFont*2*1.12));
  return {
    clock: { x: Math.round(table.x + table.width * .62), y: Math.round(table.y + table.height * .10),
      width: Math.ceil(clockFont * 5.6), height: Math.ceil(clockFont * 2.05), fontSize: clockFont },
    stakes: { x: Math.round(table.x + table.width * .006), y: Math.round(table.y + Math.max(28,table.height * .035)),
      width: Math.ceil(table.width*.285), height: Math.max(64,stakesPanelHeight),panelHeight:stakesPanelHeight,fontSize: stakesFont*2 },
  };
}
