export function createTrayManager({
  app,
  Tray,
  Menu,
  nativeImage,
  iconPath,
  overlays,
  state,
  settings,
  getSessionTime,
  startScanner,
  stopScanner,
  isScannerRunning,
  openIntervalSelector,
  startPomodoro,
  stopPomodoro,
  startBreak,
  resetPomodoro,
  resetSessionTimer,
  applySettingsPatch,
  playAlarmSound,
  showNotification,
  refreshAllOverlayPositions
}) {
  let tray = null;
  let trayRequestQuit = null;

  function buildMenu() {
    return Menu.buildFromTemplate([
      { label: `Tables: ${overlays.size}`, enabled: false },
      { label: `Timer: ${getSessionTime()}`, enabled: false },
      { type: "separator" },
      { label: (isScannerRunning() ? "Pause overlays" : "Resume overlays"), click: () => { isScannerRunning() ? stopScanner() : startScanner(); } },
      { label: state.overlaysManuallyHidden ? "Show all overlays" : "Hide all overlays", click: () => {
        state.overlaysManuallyHidden = !state.overlaysManuallyHidden;
        console.log(`[tray] Toggled to: ${state.overlaysManuallyHidden ? 'HIDDEN' : 'VISIBLE'}`);
        
        // Immediately apply visibility change to all overlays
        for (const [id, entry] of overlays) {
          try {
            if (state.overlaysManuallyHidden) {
              entry.bw.hide();
              if (entry.stakesBw && !entry.stakesBw.isDestroyed()) entry.stakesBw.hide();
              if (entry.clockBw && !entry.clockBw.isDestroyed()) entry.clockBw.hide();
            } else {
              try {
                const win = entry.tableWin;
                const isMinimized = win?.isMinimized?.();
                const activeAllowed = !state.showOnlyActiveTables || state.currentFocusedTableId == null || win?.id === state.currentFocusedTableId;
                const tableVisible = win?.isVisible?.();
                const canShow = activeAllowed;
                if (!isMinimized && canShow) {
                  entry.bw.showInactive();
                  if (entry.stakesBw && !entry.stakesBw.isDestroyed()) entry.stakesBw.showInactive();
                  if (entry.clockBw && !entry.clockBw.isDestroyed()) entry.clockBw.showInactive();
                } else if (!activeAllowed) {
                  console.log(`[tray] Skipping overlay ${id} (inactive table hidden)`);
                } else if (tableVisible === false) {
                  console.log(`[tray] Skipping overlay ${id} (table not visible)`);
                }
              } catch (e) {}
            }
          } catch (e) {
            console.error(`[tray] Failed to toggle overlay ${id}:`, e.message);
          }
        }
        tray.setContextMenu(buildMenu());
      }},
      { label: state.showOnlyActiveTables ? "Show all visible tables" : "Show only active tables", click: () => {
        applySettingsPatch({ showOnlyActiveTables: !state.showOnlyActiveTables });
        console.log(`[tray] Show only active tables: ${state.showOnlyActiveTables ? "ON" : "OFF"}`);
      }},
      { type: "separator" },
      { label: `Auto-roll: ${state.currentAutoRollInterval > 0 ? `${state.currentAutoRollInterval}s` : "turn-based"}`, enabled: false },
      { label: "Set Interval...", click: () => openIntervalSelector() },
      { type: "separator" },
      { label: "Settings...", click: () => applySettingsPatch({ openSettings: true }) },
      { label: state.quietMode ? "Enable verbose logging" : "Enable quiet mode", click: () => {
        applySettingsPatch({ quietMode: !state.quietMode });
      } },
      { label: (settings.autoStartEnabled ? "Disable Start with Windows" : "Enable Start with Windows"), click: () => {
        applySettingsPatch({ autoStartEnabled: !settings.autoStartEnabled });
      } },
      { type: "separator" },
      { label: "Pomodoro", enabled: false },
      { label: state.pomodoroIsRunning ? "Stop Pomodoro" : "Start Work (25m)", click: () => (state.pomodoroIsRunning ? stopPomodoro() : startPomodoro()) },
      { label: "Start Break (5m)", click: () => startBreak(), enabled: state.pomodoroIsRunning },
      { label: "Reset Pomodoro", click: () => resetPomodoro() },
      { label: "Test Alarm", click: () => { playAlarmSound(); showNotification("Test Alarm", "This is how the Pomodoro alarm sounds!", true); } },
      { label: "Reset Timer", click: () => resetSessionTimer() },
      { type: "separator" },
      { label: "Refresh overlays", click: () => refreshAllOverlayPositions("tray-refresh") },
      { label: "Quit", click: () => {
        console.log("[app] Quitting application...");
        stopScanner();
        if (trayRequestQuit) {
          trayRequestQuit("tray");
        } else {
          try {
            app?.quit?.();
          } catch (err) {
            console.error("[app] Quit failed:", err?.message || err);
          }
        }
      }}
    ]);
  }

  function createTrayInstance({ requestQuit } = {}) {
    trayRequestQuit = requestQuit || null;
    try {
      let img = nativeImage.createFromPath(iconPath);
      if (img.isEmpty()) {
        const pngFallback = iconPath.replace(/\.ico$/i, ".png");
        const tryPng = nativeImage.createFromPath(pngFallback);
        if (!tryPng.isEmpty()) img = tryPng;
      }
      if (img.isEmpty()) img = nativeImage.createEmpty();

      tray = new Tray(img);
      console.log("[tray] Tray created successfully");
    } catch (e) {
      console.error("[tray] Failed to create tray:", e.message);
      return null;
    }

    tray.setToolTip("Poker RNG Overlays");
    tray.setContextMenu(buildMenu());

    tray.on("click", () => console.log("[tray] Tray clicked"));
    tray.on("right-click", () => {
      console.log("[tray] Tray right-clicked");
      try { tray.setContextMenu(buildMenu()); } catch {}
      tray.popUpContextMenu();
    });

    return tray;
  }

  return {
    createTrayInstance: (options) => createTrayInstance(options),
    buildMenu: () => buildMenu(),
    getTray: () => tray
  };
}
