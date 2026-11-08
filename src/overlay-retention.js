export function updateUnmatchedTableMisses(currentMisses, options = {}) {
  const threshold = Math.max(1, Math.floor(Number(options.threshold) || 1));
  const effectiveThreshold = options.visible === false
    ? Math.min(threshold, 2)
    : threshold;

  if (options.minimized === true) {
    return { nextMisses: 0, destroy: false };
  }

  const baseMisses = Math.max(0, Math.floor(Number(currentMisses) || 0));
  const nextMisses = baseMisses + 1;
  return {
    nextMisses,
    destroy: nextMisses >= effectiveThreshold
  };
}
