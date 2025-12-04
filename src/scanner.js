export function createScanner({
  windowManager,
  settings,
  state,
  logVerbose,
  isPokerWindow,
  findMatcher,
  resolveOverlayPrefs,
  overlays,
  overlayMisses,
  createOverlayFor,
  updateOverlayPosition,
  cleanupMissing,
  destroyOverlayById,
  triggerRollForTable
}) {
  let scanTimer = null;
  let scanRunning = false;

  async function scanTables() {
    const allWindows = windowManager.getWindows();
    const windowById = new Map(allWindows.map((w) => [w.id, w]));

    const wins = allWindows.filter((w) => {
      try {
        return isPokerWindow(w);
      } catch {
        return false;
      }
    });

    const ids = new Set(wins.map((w) => w.id));

    if (wins.length === 0 && overlays.size > 0) {
      for (const id of Array.from(overlays.keys())) {
        destroyOverlayById(id, "no-poker-windows");
      }
      overlayMisses.clear();
      return;
    }

    let activeTableId = null;
    if (typeof windowManager.getActiveWindow === "function") {
      try {
        const activeWin = windowManager.getActiveWindow();
        if (activeWin && ids.has(activeWin.id)) {
          activeTableId = activeWin.id;
        }
      } catch (e) {
        if (!state.quietMode) console.error("[scan] Failed to determine active window:", e.message);
      }
    }
    state.currentFocusedTableId = activeTableId;

    for (const w of wins) {
      logVerbose(`[🔍 SCANNER CHECK] Table ID=${w.id}, hasOverlay=${overlays.has(w.id)}, title="${w.getTitle?.() || w.title}"`);
      const matcher = findMatcher ? findMatcher(w) : null;
      const overlayPrefs = resolveOverlayPrefs ? resolveOverlayPrefs(matcher) : null;
      if (overlays.has(w.id)) {
        try {
          const testTitle = w.getTitle?.() || w.title;
          if (testTitle === undefined || testTitle === null) {
            destroyOverlayById(w.id, "window-invalid");
            continue;
          }
        } catch (e) {
          destroyOverlayById(w.id, "window-access-failed");
          continue;
        }

        updateOverlayPosition(w);
      } else {
        logVerbose(`[🔍 SCANNER] Table ${w.id} "${w.getTitle?.() || w.title}" NOT in overlays map - will create`);
        logVerbose(`[scan] ? Found poker table: "${w.getTitle?.() || w.title || w.id}"`);
        createOverlayFor(w, { overlayPrefs, matcher });
        setImmediate(() => {
          if (overlays.has(w.id)) {
            updateOverlayPosition(w);
          }
        });
      }
    }

    if (activeTableId) {
      const activeWindow =
        windowById.get(activeTableId) ||
        (typeof windowManager.getActiveWindow === "function" ? windowManager.getActiveWindow() : null);

      const recognitionEnabled = settings.turnRecognition?.enabled === true;
      const shouldAttempt = recognitionEnabled || activeTableId !== state.lastActiveTableId;

      if (shouldAttempt) {
        const didRoll = await triggerRollForTable(activeTableId, "active-focus", {
          window: activeWindow,
          viaFocus: true
        });
        if (!recognitionEnabled || didRoll) {
          state.lastActiveTableId = activeTableId;
        } else {
          state.lastActiveTableId = null;
        }
      }
    } else {
      state.lastActiveTableId = null;
    }

    cleanupMissing(ids, windowById);

    if (!state.quietMode && (wins.length > 0 || overlays.size > 0)) {
      console.log(`[scan] Tables: ${wins.length}, Overlays: ${overlays.size}, Active: ${activeTableId ?? "none"}`);
    }
  }

  function startScanner() {
    if (scanTimer) clearInterval(scanTimer);
    const intervalMs = Math.max(120, Number(settings.scanMs) || 300);

    const tick = async () => {
      if (scanRunning) return;
      scanRunning = true;
      try {
        await scanTables();
      } catch (e) {
        console.error("[scan] Tick failed:", e.message || e);
      } finally {
        scanRunning = false;
      }
    };

    tick();
    scanTimer = setInterval(() => {
      void tick();
    }, intervalMs);
  }

  function stopScanner() {
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
    scanRunning = false;
  }

  return {
    startScanner,
    stopScanner,
    isRunning: () => !!scanTimer
  };
}
