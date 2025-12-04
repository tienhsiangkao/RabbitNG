import path from "path";

export function createOverlayManager({
  app,
  BrowserWindow,
  windowManager,
  iconPath,
  settings,
  state,
  logVerbose,
  defaultTurnRecognition,
  isPlayerTurn,
  persistSettingsSnapshot,
  parseStakes,
  onIntervalChanged = () => {}
}) {
  const overlays = new Map();
  const overlayMisses = new Map(); // consecutive scan misses per table id
  const turnDetectionFailures = new Map();

  function overlayRectFor(b) {
    const overlayConfig = settings.overlays || {};

    const basePctSmall = overlayConfig.basePctSmall || 0.08;
    const minW = overlayConfig.minW || 64;
    const minH = overlayConfig.minH || 48;

    const tableArea = b.width * b.height;
    const baseSize = Math.sqrt(tableArea) * basePctSmall;

    const width = Math.max(minW, Math.floor(baseSize * 1.2));
    const height = Math.max(minH, Math.floor(baseSize * 0.9));

    const position = overlayConfig.position || {};
    const anchor = overlayConfig.anchor || { xPct: 0.5, yPct: 0.9 };
    const mode = position.mode || "anchor";
    const edge = position.edge || "top-right";
    const padX = position.padX || 24;
    const padY = position.padY || 24;

    let x;
    let y;

    if (mode === "anchor") {
      const centerX = b.x + Math.floor(b.width * anchor.xPct);
      const centerY = b.y + Math.floor(b.height * anchor.yPct);
      x = centerX - Math.floor(width / 2);
      y = centerY - Math.floor(height / 2);
    } else if (mode === "edge") {
      switch (edge) {
        case "top-right":
          x = b.x + b.width - width - padX;
          y = b.y + padY;
          break;
        case "top-left":
          x = b.x + padX;
          y = b.y + padY;
          break;
        case "bottom-right":
          x = b.x + b.width - width - padX;
          y = b.y + b.height - height - padY;
          break;
        case "bottom-left":
          x = b.x + padX;
          y = b.y + b.height - height - padY;
          break;
        default:
          x = b.x + b.width - width - padX;
          y = b.y + padY;
      }
    } else {
      x = b.x + Math.floor(b.width * anchor.xPct);
      y = b.y + Math.floor(b.height * anchor.yPct);
    }

    const maxX = b.x + b.width - width;
    const maxY = b.y + b.height - height;
    x = Math.max(b.x, Math.min(maxX, x));
    y = Math.max(b.y, Math.min(maxY, y));

    logVerbose(
      `[overlay] Config-based sizing: ${width}x${height} at ${mode === "edge" ? `edge(${edge})` : `anchor(${anchor.xPct},${anchor.yPct})`} (table: ${b.width}x${b.height})`
    );

    return {
      x,
      y,
      width,
      height
    };
  }

  function setAutoRollInterval(seconds) {
    let requested = Number(seconds);
    if (!Number.isFinite(requested) || requested < 0) {
      requested = 0;
    }
    if (requested > 0) {
      requested = Math.max(1, Math.min(60, Math.floor(requested)));
    } else {
      requested = 0;
    }
    state.currentAutoRollInterval = requested;

    settings.autoRollMs = state.currentAutoRollInterval > 0 ? state.currentAutoRollInterval * 1000 : 0;
    persistSettingsSnapshot(settings, "auto-roll interval");

    const payloadMs = state.currentAutoRollInterval > 0 ? state.currentAutoRollInterval * 1000 : 0;
    for (const [id, { bw }] of overlays) {
      try {
        bw.webContents.send("set-auto-roll-interval", payloadMs);
      } catch (e) {
        console.error(`Failed to send auto-roll interval to overlay ${id}:`, e.message);
      }
    }

    if (state.currentAutoRollInterval > 0) {
      console.log(`[settings] Auto-roll interval set to ${state.currentAutoRollInterval} seconds`);
    } else {
      console.log("[settings] Auto-roll interval disabled (turn-based mode)");
    }

    onIntervalChanged();
  }

  async function triggerRollForTable(tableId, reason, options = {}) {
    if (state.overlaysManuallyHidden) return false;
    const entry = overlays.get(tableId);
    if (!entry) return false;

    const bw = entry.bw;
    if (!bw || bw.isDestroyed?.()) return false;
    const wc = bw.webContents;
    if (!wc || wc.isDestroyed?.()) return false;

    if (wc.isLoading?.()) {
      if (!entry.pendingRoll) {
        entry.pendingRoll = { reason, options };
        wc.once("did-finish-load", () => {
          const pending = entry.pendingRoll;
          entry.pendingRoll = null;
          triggerRollForTable(
            tableId,
            pending?.reason || "post-load",
            pending?.options || {}
          ).catch((err) => console.error("[autoroll] Deferred roll failed:", err.message));
        });
      }
      return false;
    }

    const turnConfig = settings.turnRecognition || defaultTurnRecognition;
    const recognitionEnabled = turnConfig.enabled === true;
    const viaFocus = options.viaFocus === true;
    const skipVisibilityTrigger =
      recognitionEnabled &&
      reason === "overlay-shown" &&
      !turnConfig.triggerOnVisibilityChange;

    if (skipVisibilityTrigger && !viaFocus) {
      if (turnConfig.logOnSkip !== false) {
        logVerbose(`[autoroll] Skipped visibility roll for "${entry.lastTitle || tableId}" (pattern gating)`);
      }
      return false;
    }

    if (recognitionEnabled) {
      let targetWindow = options.window;
      if (!targetWindow) {
        targetWindow = windowManager.getWindows().find((w) => w.id === tableId);
      }
      if (!targetWindow) {
        logVerbose(`[autoroll] Could not locate window for table ${tableId}; suppressing roll`);
        return false;
      }
      try {
        const allowed = await isPlayerTurn(targetWindow, turnConfig, {
          title: entry.lastTitle,
          reason,
          quietMode: state.quietMode,
          debug: !state.quietMode
        });
        const previouslyMatched = entry.turnRecognitionMatched === true;
        entry.turnRecognitionMatched = allowed === true;
        turnDetectionFailures.delete(tableId);
        if (!allowed) {
          if (turnConfig.logOnSkip !== false) {
            logVerbose(`[autoroll] Pattern check blocked roll for "${entry.lastTitle || tableId}" (${reason})`);
          }
          return false;
        }
        if (previouslyMatched && options.forceRepeat !== true) {
          if (turnConfig.logOnSkip !== false) {
            logVerbose(`[autoroll] Skipping repeat roll for "${entry.lastTitle || tableId}" (${reason})`);
          }
          return false;
        }
      } catch (err) {
        const nextFail = (turnDetectionFailures.get(tableId) || 0) + 1;
        turnDetectionFailures.set(tableId, nextFail);
        if (nextFail >= 3) {
          console.warn(
            `[autoroll] Turn detection repeatedly failed (${nextFail}) for "${entry.lastTitle || tableId}" (${reason}); allowing roll`
          );
        } else {
          console.error(
            `[autoroll] Turn detection failed for "${entry.lastTitle || tableId}" (${reason}), attempt ${nextFail}:`,
            err.message
          );
          return false;
        }
      }
    } else {
      entry.turnRecognitionMatched = false;
    }

    try {
      wc.send("roll-now");
      entry.pendingRoll = null;
      entry.lastRollAt = Date.now();
      const title = entry.lastTitle || `table ${tableId}`;
      logVerbose(`[autoroll] Triggered roll for "${title}" (${reason})`);
      return true;
    } catch (e) {
      console.error(`[autoroll] Failed to trigger roll for table ${tableId}:`, e.message);
      return false;
    }
  }

  function createStakesOverlay(win, tableBounds, overlayPrefs) {
    const allowStakes = overlayPrefs?.stakesEnabled ?? settings.overlays?.stakesEnabled !== false;
    if (!allowStakes) return;
    const id = win.id;
    const title = win.getTitle?.() || win.title || "";
    const stakes = parseStakes(title);

    if (!stakes) return;

    const stakesId = `${id}_stakes`;
    const buyInAmount = stakes.big * 100;
    const isRushCash = title.includes("Rush & Cash");
    let displayText;
    if (isRushCash) {
      const zMatch = title.match(/\bZ(\d+)\b/i);
      displayText = zMatch ? `Z${zMatch[1]}` : `Z${Math.round(buyInAmount)}`;
    } else {
      displayText = `NL${Math.round(stakes.big * 100)}`;
    }

    const tableDiagonal = Math.sqrt(tableBounds.width * tableBounds.width + tableBounds.height * tableBounds.height);
    const fontSize = Math.max(20, Math.floor(tableDiagonal * 0.04 * (2 / 3)));
    const stakesWidth = Math.max(isRushCash ? 80 : 110, Math.floor(fontSize * (isRushCash ? 2 : 3.5)));
    const stakesHeight = Math.max(36, Math.floor(fontSize * 1.5));

    const stakesX = tableBounds.x + 10;
    const stakesY = tableBounds.y + Math.floor(tableBounds.height * 0.05);

    const stakesBw = new BrowserWindow({
      x: stakesX,
      y: stakesY,
      width: stakesWidth,
      height: stakesHeight,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      alwaysOnTop: true,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      icon: iconPath,
      minimizable: false,
      maximizable: false,
      closable: false,
      thickFrame: false,
      titleBarStyle: "hidden",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });

    try { stakesBw.setIgnoreMouseEvents(true); } catch {}
    try { stakesBw.setAlwaysOnTop(true, "screen-saver"); } catch { stakesBw.setAlwaysOnTop(true); }

    const stakesHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body {
            width: 100%;
            height: 100%;
            overflow: hidden;
            position: fixed;
          }
          body {
            background: rgba(0, 0, 0, 0.75);
            color: #FFD700;
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: ${fontSize}px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 3px solid rgba(255, 215, 0, 0.4);
            border-radius: 8px;
          }
          .bi {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: clip;
            line-height: 1;
          }
        </style>
      </head>
      <body>
        <div class="bi">${displayText}</div>
      </body>
      </html>
    `;

    stakesBw.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(stakesHTML)}`);

    stakesBw.once("ready-to-show", () => {
      stakesBw.setContentSize(stakesWidth, stakesHeight);
      stakesBw.setMinimumSize(stakesWidth, stakesHeight);
      stakesBw.setMaximumSize(stakesWidth, stakesHeight);
      logVerbose(`[overlay] Stakes overlay ready for table ${id}`);
      let tableMinimized = false;
      try {
        tableMinimized = win.isMinimized?.() || false;
      } catch {}
      const allowAutoShow =
        !state.overlaysManuallyHidden &&
        !tableMinimized &&
        (!state.showOnlyActiveTables || state.currentFocusedTableId == null || win.id === state.currentFocusedTableId);
      if (allowAutoShow) {
        stakesBw.showInactive();
        logVerbose("[overlay] ✅ Showing stakes overlay");
      } else if (state.overlaysManuallyHidden) {
        logVerbose("[overlay] ⏸️ Stakes overlay hidden (manually hidden)");
      } else if (state.showOnlyActiveTables) {
        logVerbose("[overlay] ⏸️ Stakes overlay hidden (table not visible)");
      }
    });

    const entry = overlays.get(id);
    if (entry) {
      entry.stakesBw = stakesBw;
      entry.stakesLastBounds = { x: stakesX, y: stakesY, width: stakesWidth, height: stakesHeight };
      entry.stakesLabel = displayText;
      entry.stakesId = stakesId;
    }
  }

  function createClockOverlay(win, tableBounds, overlayPrefs) {
    const allowClock = overlayPrefs?.clockEnabled ?? settings.overlays?.clockEnabled !== false;
    if (!allowClock) return;
    try {
      const id = win.id;
      logVerbose(`[DEBUG] Creating clock overlay for table: ${id}`);

      const tableDiagonal = Math.sqrt(tableBounds.width * tableBounds.width + tableBounds.height * tableBounds.height);
      const fontSize = Math.max(20, Math.floor(tableDiagonal * 0.04));
      const clockWidth = Math.floor(fontSize * 5);
      const clockHeight = Math.floor(fontSize * 2.2);
      const clockOffsetX = Math.floor(tableBounds.width * 0.12);

      const clockX = tableBounds.x + tableBounds.width - clockWidth - clockOffsetX;
      const clockY = tableBounds.y + 10;

      const clockBw = new BrowserWindow({
        x: clockX,
        y: clockY,
        width: clockWidth,
        height: clockHeight,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        resizable: false,
        alwaysOnTop: true,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        show: false,
        icon: iconPath,
        minimizable: false,
        maximizable: false,
        closable: false,
        thickFrame: false,
        titleBarStyle: "hidden",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false
        }
      });

      try { clockBw.setIgnoreMouseEvents(true); } catch {}
      try { clockBw.setAlwaysOnTop(true, "screen-saver"); } catch { clockBw.setAlwaysOnTop(true); }

      clockBw.loadFile(path.join(app.getAppPath(), "clock.html")).catch((err) => console.error("clock load:", err));

      clockBw.once("ready-to-show", () => {
        clockBw.setContentSize(clockWidth, clockHeight);
        clockBw.setMinimumSize(clockWidth, clockHeight);
        clockBw.setMaximumSize(clockWidth, clockHeight);
        logVerbose(`[overlay] Clock overlay ready for table ${id}`);
        let tableMinimized = false;
        try {
          tableMinimized = win.isMinimized?.() || false;
        } catch {}
        const allowAutoShow =
          !state.overlaysManuallyHidden &&
          !tableMinimized &&
          (!state.showOnlyActiveTables || state.currentFocusedTableId == null || win.id === state.currentFocusedTableId);
        if (allowAutoShow) {
          clockBw.showInactive();
          logVerbose("[overlay] ✅ Showing clock overlay");
        } else if (state.overlaysManuallyHidden) {
          logVerbose("[overlay] ⏸️ Clock overlay hidden (manually hidden)");
        } else if (state.showOnlyActiveTables) {
          logVerbose("[overlay] ⏸️ Clock overlay hidden (table not visible)");
        }

        setTimeout(() => {
          try {
            clockBw.webContents.executeJavaScript(`
              document.body.style.fontSize = "${fontSize}px";
            `);
          } catch (e) {
            console.error("[DEBUG] Clock font size failed:", e.message);
          }
        }, 500);
      });

      const entry = overlays.get(id);
      if (entry) {
        entry.clockBw = clockBw;
        entry.clockLastBounds = { x: clockX, y: clockY, width: clockWidth, height: clockHeight };
      }
    } catch (err) {
      console.error(`[ERROR] Failed to create clock overlay for table ${win.id}:`, err);
    }
  }

  function createOverlayFor(win, opts = {}) {
    const id = win.id;
    logVerbose(`[CREATE START] Creating overlay for table ID=${id}`);
    const title = win.getTitle?.() || win.title || "";
    const tbl = win.getBounds();
    const r = overlayRectFor(tbl);
    const overlayPrefs = {
      stakesEnabled: settings.overlays?.stakesEnabled !== false,
      clockEnabled: settings.overlays?.clockEnabled !== false,
      ...(opts.overlayPrefs || {})
    };

    const bw = new BrowserWindow({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      alwaysOnTop: true,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      icon: iconPath,
      minimizable: false,
      maximizable: false,
      closable: false,
      thickFrame: false,
      titleBarStyle: "hidden",
      webPreferences: {
        preload: path.join(app.getAppPath(), "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });

    try { bw.setIgnoreMouseEvents(false); } catch {}
    try { bw.setAlwaysOnTop(true, "screen-saver"); } catch { bw.setAlwaysOnTop(true); }
    try { bw.setAspectRatio(0.75); } catch {}

    bw.loadFile(path.join(app.getAppPath(), "index.html")).catch((err) => console.error("overlay load:", err));
    bw.once("ready-to-show", () => {
      logVerbose(`[overlay] Main overlay ready for table ${id}`);
      let tableMinimized = false;
      try {
        tableMinimized = win.isMinimized?.() || false;
      } catch {}
      const allowAutoShow =
        !state.overlaysManuallyHidden &&
        !tableMinimized &&
        (!state.showOnlyActiveTables || state.currentFocusedTableId == null || win.id === state.currentFocusedTableId);
      if (allowAutoShow) {
        bw.showInactive();
        logVerbose(`[overlay] ✅ Showing overlay for ${title}`);
      } else if (state.overlaysManuallyHidden) {
        logVerbose(`[overlay] ⏸️ Keeping overlay hidden for ${title} (manually hidden)`);
      } else if (state.showOnlyActiveTables) {
        logVerbose(`[overlay] ⏸️ Hidden for ${title} (table not visible)`);
      }

      try {
        bw.webContents.send("table-size", { width: tbl.width, height: tbl.height });
        bw.webContents.send(
          "set-auto-roll-interval",
          state.currentAutoRollInterval > 0 ? state.currentAutoRollInterval * 1000 : 0
        );
        logVerbose(`[DEBUG] Sent table size: ${tbl.width}x${tbl.height} to overlay`);

        setTimeout(() => {
          try {
            const tableDiagonal = Math.sqrt(tbl.width * tbl.width + tbl.height * tbl.height);
            const fontSize = Math.max(28, Math.floor(tableDiagonal * 0.15));
            bw.webContents.executeJavaScript(`
              const num = document.getElementById("num");
              if (num) {
                num.style.fontSize = "${fontSize}px";
              }
            `);
          } catch (e) {
            console.error("[DEBUG] Fallback font size failed:", e.message);
          }
        }, 1000);
      } catch (e) {
        console.error("[DEBUG] Failed to send table size:", e.message);
      }
    });

    overlays.set(id, {
      bw,
      lastBounds: r,
      lastTitle: title,
      lastRollAt: 0,
      pendingRoll: null,
      tableWin: win,
      turnRecognitionMatched: false,
      overlayPrefs
    });

    logVerbose(`[🆕 OVERLAY CREATED] ID=${id}, title="${title}", manuallyHidden=${state.overlaysManuallyHidden}`);

    createStakesOverlay(win, tbl, overlayPrefs);
    createClockOverlay(win, tbl, overlayPrefs);
  }

  function updateOverlayPosition(win) {
    const entry = overlays.get(win.id);
    if (!entry) return;

    const tbl = win.getBounds();
    const r = overlayRectFor(tbl);
    entry.tableWin = win;
    const currentTitle = win.getTitle?.() || win.title || entry.lastTitle || "";
    entry.lastTitle = currentTitle;

    if (state.overlaysManuallyHidden) {
      try { if (entry.bw?.isVisible?.()) entry.bw.hide(); } catch {}
      try { if (entry.stakesBw && entry.stakesBw.isVisible?.()) entry.stakesBw.hide(); } catch {}
      try { if (entry.clockBw && entry.clockBw.isVisible?.()) entry.clockBw.hide(); } catch {}
      entry.lastBounds = r;
      return;
    }

    const overlayPrefs = entry.overlayPrefs || {};
    const allowStakes = overlayPrefs.stakesEnabled ?? settings.overlays?.stakesEnabled !== false;
    const allowClock = overlayPrefs.clockEnabled ?? settings.overlays?.clockEnabled !== false;

    if (allowStakes && (!entry.stakesBw || entry.stakesBw.isDestroyed()) && parseStakes(currentTitle)) {
      createStakesOverlay(win, tbl, overlayPrefs);
    }
    if (allowClock && (!entry.clockBw || entry.clockBw.isDestroyed())) {
      createClockOverlay(win, tbl, overlayPrefs);
    }
    if (!allowStakes && entry.stakesBw && !entry.stakesBw.isDestroyed()) {
      try { entry.stakesBw.destroy(); } catch {}
      entry.stakesBw = null;
    }
    if (!allowClock && entry.clockBw && !entry.clockBw.isDestroyed()) {
      try { entry.clockBw.destroy(); } catch {}
      entry.clockBw = null;
    }

    const currentBounds = entry.bw.getBounds();
    if (
      currentBounds.x !== r.x ||
      currentBounds.y !== r.y ||
      currentBounds.width !== r.width ||
      currentBounds.height !== r.height
    ) {
      entry.bw.setBounds(r, false);
      try { entry.bw.moveTop(); } catch {}
    }

    if (entry.stakesBw && !entry.stakesBw.isDestroyed()) {
      const title = entry.lastTitle || "";
      const stakes = parseStakes(title);

      if (stakes) {
        const isRushCash = title.includes("Rush & Cash");
        const buyInAmount = stakes.big * 100;
        let displayText;
        if (isRushCash) {
          const zMatch = title.match(/\bZ(\d+)\b/i);
          displayText = zMatch ? `Z${zMatch[1]}` : `Z${Math.round(buyInAmount)}`;
        } else {
          displayText = `NL${Math.round(stakes.big * 100)}`;
        }

        const tableDiagonal = Math.sqrt(tbl.width * tbl.width + tbl.height * tbl.height);
        const fontSize = Math.max(20, Math.floor(tableDiagonal * 0.04 * (2 / 3)));
        const stakesWidth = Math.max(isRushCash ? 80 : 110, Math.floor(fontSize * (isRushCash ? 2 : 3.5)));
        const stakesHeight = Math.max(36, Math.floor(fontSize * 1.5));

        const stakesX = tbl.x + 10;
        const stakesY = tbl.y + Math.floor(tbl.height * 0.05);

        const currentStakesBounds = entry.stakesBw.getBounds();
        if (
          currentStakesBounds.x !== stakesX ||
          currentStakesBounds.y !== stakesY ||
          currentStakesBounds.width !== stakesWidth ||
          currentStakesBounds.height !== stakesHeight
        ) {
          entry.stakesBw.setMinimumSize(stakesWidth, stakesHeight);
          entry.stakesBw.setMaximumSize(stakesWidth, stakesHeight);
          entry.stakesBw.setBounds({ x: stakesX, y: stakesY, width: stakesWidth, height: stakesHeight }, false);

          try {
            entry.stakesBw.webContents.executeJavaScript(`
              document.body.style.fontSize = "${fontSize}px";
            `);
          } catch (e) {}

          try { entry.stakesBw.moveTop(); } catch {}
        }

        if (entry.stakesLabel !== displayText) {
          entry.stakesLabel = displayText;
          try {
            entry.stakesBw.webContents.executeJavaScript(`
              const label = document.querySelector('.bi');
              if (label) label.textContent = ${JSON.stringify(displayText)};
            `);
          } catch (e) {}
        }
      }
    }

    if (entry.clockBw && !entry.clockBw.isDestroyed()) {
      const tableDiagonal = Math.sqrt(tbl.width * tbl.width + tbl.height * tbl.height);
      const fontSize = Math.max(20, Math.floor(tableDiagonal * 0.04));
      const clockWidth = Math.floor(fontSize * 5);
      const clockHeight = Math.floor(fontSize * 2.2);

      const clockOffsetX = Math.floor(tbl.width * 0.12);
      const clockX = tbl.x + tbl.width - clockWidth - clockOffsetX;
      const clockY = tbl.y + 10;

      const currentClockBounds = entry.clockBw.getBounds();
      if (
        currentClockBounds.x !== clockX ||
        currentClockBounds.y !== clockY ||
        currentClockBounds.width !== clockWidth ||
        currentClockBounds.height !== clockHeight
      ) {
        entry.clockBw.setBounds({ x: clockX, y: clockY, width: clockWidth, height: clockHeight }, false);

        try {
          entry.clockBw.webContents.executeJavaScript(`
            document.body.style.fontSize = "${fontSize}px";
          `);
        } catch (e) {}

        try { entry.clockBw.moveTop(); } catch {}
      }
    }

    try {
      let isMinimized = false;

      try {
        isMinimized = win.isMinimized?.() || false;
      } catch (e) {
        destroyOverlayById(win.id, "window-closed");
        return;
      }
      const overlayVisible = entry.bw.isVisible();
      const isOverlayReady = !entry.bw.isDestroyed() && entry.bw.webContents && !entry.bw.webContents.isLoading();
      const passesActiveFilter =
        !state.showOnlyActiveTables ||
        state.currentFocusedTableId == null ||
        win.id === state.currentFocusedTableId;
      const shouldShowOverlay =
        !isMinimized &&
        !state.overlaysManuallyHidden &&
        passesActiveFilter;
      const shouldHideOverlay =
        isMinimized ||
        state.overlaysManuallyHidden ||
        !passesActiveFilter;

      logVerbose(`[SCANNER] ${entry.lastTitle}:`);
      logVerbose(`  - isMinimized: ${isMinimized}`);
      logVerbose(`  - overlaysManuallyHidden: ${state.overlaysManuallyHidden}`);
      logVerbose(`  - passesActiveFilter: ${passesActiveFilter}`);
      logVerbose(`  - shouldShowOverlay: ${shouldShowOverlay}`);

      try {
        if (shouldShowOverlay && isOverlayReady) {
          if (!overlayVisible) {
            logVerbose(`[SCANNER] ✅ SHOWING overlay for ${entry.lastTitle}`);
            entry.bw.showInactive();
          }
          entry.bw.moveTop?.();
          if (entry.stakesBw && !entry.stakesBw.isDestroyed()) {
            if (entry.stakesBw.isVisible?.() === false) {
              entry.stakesBw.showInactive();
            }
            entry.stakesBw.moveTop?.();
          }
          if (entry.clockBw && !entry.clockBw.isDestroyed()) {
            if (entry.clockBw.isVisible?.() === false) {
              entry.clockBw.showInactive();
            }
            entry.clockBw.moveTop?.();
          }
        } else if (shouldHideOverlay && overlayVisible) {
          logVerbose(`[SCANNER] ❌ HIDING overlay for ${entry.lastTitle}`);
          entry.bw.hide();
          if (entry.stakesBw && !entry.stakesBw.isDestroyed()) {
            entry.stakesBw.hide();
          }
          if (entry.clockBw && !entry.clockBw.isDestroyed()) {
            entry.clockBw.hide();
          }
        }
      } catch (e) {
        console.error("[SCANNER] Failed to sync visibility:", e.message);
      }
    } catch (e) {
      console.error("[SCANNER] Visibility sync failed:", e.message);
    }

    try {
      entry.bw.webContents.send("table-size", { width: tbl.width, height: tbl.height });
      logVerbose(`[DEBUG] Updated table size: ${tbl.width}x${tbl.height} to overlay`);
    } catch (e) {
      console.error("[DEBUG] Failed to update table size:", e.message);
    }
    entry.lastBounds = r;
  }

  function refreshAllOverlayPositions(reason = "manual-refresh") {
    for (const [id, entry] of overlays) {
      const win = entry.tableWin;
      if (!win) continue;
      try {
        updateOverlayPosition(win);
      } catch (err) {
        console.error(`[overlay] Failed to refresh overlay ${id} (${reason}):`, err.message);
      }
    }
  }

  function destroyOverlayById(id, reason = "cleanup") {
    const entry = overlays.get(id);
    if (!entry) return;

    overlays.delete(id);
    overlayMisses.delete(id);
    turnDetectionFailures.delete(id);

    const windowsToClose = [entry.bw, entry.stakesBw, entry.clockBw];
    for (const win of windowsToClose) {
      if (!win) continue;
      try { if (win.isVisible?.()) win.hide(); } catch {}
      try { win.removeAllListeners?.(); } catch {}
      try { win.close(); } catch {}
      try { win.destroy(); } catch {}
    }

    logVerbose(`[scan] Destroyed overlay ${id}${reason ? ` (${reason})` : ""}`);
  }

  function cleanupMissing(currentIds, windowById) {
    for (const [id] of overlays) {
      const win = windowById.get(id);
      const bw = overlays.get(id)?.bw;

      if (!win || !bw || bw.isDestroyed?.()) {
        destroyOverlayById(id, "window-missing");
        overlayMisses.delete(id);
        continue;
      }

      try {
        const visible = win.isVisible?.();
        if (visible === false) {
          destroyOverlayById(id, "window-not-visible");
          overlayMisses.delete(id);
          continue;
        }
      } catch {}

      if (currentIds.has(id)) {
        overlayMisses.delete(id);
        continue;
      }

      let titleOk = false;
      try {
        const t = win.getTitle?.() || win.title;
        titleOk = !!t;
      } catch {}

      if (!titleOk) {
        destroyOverlayById(id, "window-empty-title");
        overlayMisses.delete(id);
        continue;
      }

      destroyOverlayById(id, "window-not-poker");
      overlayMisses.delete(id);
    }
  }

  return {
    overlays,
    overlayMisses,
    triggerRollForTable,
    createOverlayFor,
    updateOverlayPosition,
    refreshAllOverlayPositions,
    destroyOverlayById,
    cleanupMissing,
    setAutoRollInterval,
    refreshOverlayFeatures: () => {
      for (const [, entry] of overlays) {
        const overlayPrefs = entry.overlayPrefs || {};
        const allowStakes = overlayPrefs.stakesEnabled ?? settings.overlays?.stakesEnabled !== false;
        const allowClock = overlayPrefs.clockEnabled ?? settings.overlays?.clockEnabled !== false;
        if (!allowStakes && entry.stakesBw && !entry.stakesBw.isDestroyed()) {
          try { entry.stakesBw.destroy(); } catch {}
          entry.stakesBw = null;
        }
        if (!allowClock && entry.clockBw && !entry.clockBw.isDestroyed()) {
          try { entry.clockBw.destroy(); } catch {}
          entry.clockBw = null;
        }
        const tbl = entry.tableWin?.getBounds?.();
        if (tbl) {
          if (allowStakes && (!entry.stakesBw || entry.stakesBw.isDestroyed()) && parseStakes(entry.lastTitle || entry.tableWin?.getTitle?.())) {
            createStakesOverlay(entry.tableWin, tbl, overlayPrefs);
          }
          if (allowClock && (!entry.clockBw || entry.clockBw.isDestroyed())) {
            createClockOverlay(entry.tableWin, tbl, overlayPrefs);
          }
        }
      }
    }
  };
}
