function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function normalizedAnchorFromRect(rect, tableBounds) {
  const tableX = numberOr(tableBounds?.x, 0);
  const tableY = numberOr(tableBounds?.y, 0);
  const tableWidth = Math.max(1, numberOr(tableBounds?.width, 1));
  const tableHeight = Math.max(1, numberOr(tableBounds?.height, 1));
  const x = numberOr(rect?.x, tableX);
  const y = numberOr(rect?.y, tableY);

  return {
    xPct: Number(clamp01((x - tableX) / tableWidth).toFixed(4)),
    yPct: Number(clamp01((y - tableY) / tableHeight).toFixed(4))
  };
}

export function anchorsEqual(a, b, tolerance = 0.0001) {
  return (
    Math.abs(Number(a?.xPct ?? 0) - Number(b?.xPct ?? 0)) < tolerance &&
    Math.abs(Number(a?.yPct ?? 0) - Number(b?.yPct ?? 0)) < tolerance
  );
}
