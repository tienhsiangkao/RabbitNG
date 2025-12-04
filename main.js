// Overlays + autostart + tray
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { createRequire } from "module";
import { isPlayerTurn } from "./src/turn-detector.js";
import { initializeSettings } from "./src/settings-loader.js";
import { createOverlayManager } from "./src/overlay-manager.js";
import { createScanner } from "./src/scanner.js";
import { createTrayManager } from "./src/tray.js";
import { parseStakes, isStrictRushCashTableTitle, buildColorTierRegexFromConfig } from "./src/table-helpers.js";
// simple logging helper

const require = createRequire(import.meta.url);
const {
  app,
  BrowserWindow,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  Notification
} = require("electron");
const { windowManager } = require("node-window-manager");

const { settings, persistSettingsSnapshot, defaultTurnRecognition, mergeColorTierRules, mergeOverlayConfig } =
  initializeSettings(app);

const state = {
  quietMode: settings.quietMode !== false, // default quiet unless explicitly false
  showOnlyActiveTables: settings.showOnlyActiveTables === true,
  overlaysManuallyHidden: false,
  currentAutoRollInterval: 0,
  currentFocusedTableId: null,
  lastActiveTableId: null
};

let isExplicitQuit = false;

let tray = null;
const logVerbose = (...args) => {
  if (!state.quietMode) {
    console.log(...args);
  }
};
let isTogglingOverlays = false; // Flag to prevent scanner interference during manual toggle
let intervalSelectorWindow = null; // Window for interval selector
let settingsWindow = null; // Settings UI
let sessionTimer = null; // Timer to update session time
let sessionTimerValue = 0; // Current timer value in seconds (like an alarm clock)
let sessionStartTime = Date.now(); // Track when the application started
let pomodoroTimer = 25 * 60; // Pomodoro timer in seconds (25 minutes)
let pomodoroIsRunning = false; // Whether Pomodoro timer is active
let pomodoroMode = 'work'; // 'work' or 'break'
state.sessionStartTime = Date.now(); // Track when the application started
state.sessionTimerValue = 0; // Current timer value in seconds (like an alarm clock)
state.pomodoroTimer = 25 * 60; // Pomodoro timer in seconds (25 minutes)
state.pomodoroIsRunning = false; // Whether Pomodoro timer is active
state.pomodoroMode = "work"; // 'work' or 'break'

const storedAutoRollMs = Number(settings.autoRollMs);
if (Number.isFinite(storedAutoRollMs) && storedAutoRollMs > 0) {
  const storedSeconds = Math.floor(storedAutoRollMs / 1000);
  if (storedSeconds > 0) {
    state.currentAutoRollInterval = Math.max(1, Math.min(60, storedSeconds));
    settings.autoRollMs = state.currentAutoRollInterval * 1000;
  } else {
    state.currentAutoRollInterval = 0;
    settings.autoRollMs = 0;
  }
} else {
  state.currentAutoRollInterval = 0;
  settings.autoRollMs = 0;
}
let computedAutoStart = true;
try {
  computedAutoStart = isAutoStartEnabled();
} catch (err) {
  logVerbose("[settings] Unable to read current auto-start setting:", err.message);
}
if (typeof settings.autoStartEnabled !== "boolean") {
  settings.autoStartEnabled = computedAutoStart;
  persistSettingsSnapshot(settings, "auto-start default");
}
if (typeof settings.showOnlyActiveTables === "boolean") {
  state.showOnlyActiveTables = settings.showOnlyActiveTables;
} else {
  settings.showOnlyActiveTables = state.showOnlyActiveTables;
  persistSettingsSnapshot(settings, "settings defaults");
}
// Clear any stale drag offset unless user explicitly enabled remembering
if (settings.overlays?.rememberDefaultOnDrag !== true && settings.overlays?.dragOffset) {
  delete settings.overlays.dragOffset;
  persistSettingsSnapshot(settings, "clear drag offset");
}


settings.colorTierRules = mergeColorTierRules(settings.colorTierRules);

settings.overlays = mergeOverlayConfig(settings.overlays);

if (!Array.isArray(settings.excludeTitlePrefixes)) {
  settings.excludeTitlePrefixes = [];
}

let colorTierRegex = null;
colorTierRegex = buildColorTierRegexFromConfig(settings.colorTierRules);

const isDev = !app.isPackaged;
const iconPath = isDev
  ? path.join(app.getAppPath(), "assets", "icons", "app.ico")
  : path.join(process.resourcesPath, "assets", "icons", "app.ico");

try { logVerbose("Tray icon path:", iconPath, "exists:", fs.existsSync(iconPath)); } catch {}

const overlayManager = createOverlayManager({
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
  onIntervalChanged: () => {
    if (tray) {
      try {
        tray.setContextMenu(trayBuildMenu());
      } catch (e) {
        console.error("Failed to update tray menu:", e.message);
      }
    }
  }
});

const {
  overlays,
  overlayMisses,
  triggerRollForTable,
  createOverlayFor,
  updateOverlayPosition,
  refreshAllOverlayPositions,
  destroyOverlayById,
  cleanupMissing,
  setAutoRollInterval,
  refreshOverlayFeatures
} = overlayManager;

function normTitle(t) {
  return (t || "").trim();
}


function beginsWithOne(title, prefixes) {
  if (!prefixes || prefixes.length === 0) return false;
  const norm = normTitle(title);
  return prefixes.some(prefix => norm.startsWith(prefix));
}

function beginsWithOneCaseInsensitive(title, prefixes) {
  if (!prefixes || prefixes.length === 0) return false;
  const norm = normTitle(title).toLowerCase();
  return prefixes.some((prefix) => {
    if (!prefix) return false;
    return norm.startsWith(String(prefix).trim().toLowerCase());
  });
}

function containsKeywords(title, keywords) {
  if (!keywords || keywords.length === 0) return false;
  const norm = normTitle(title).toLowerCase();
  return keywords.some(keyword => {
    const keywordLower = keyword.toLowerCase();
    // Strict matching - only match exact keywords, no broad matching
    return norm.includes(keywordLower);
  });
}

function isPokerWindow(win) {
  try {
    // Get window title and validate
    const titleRaw = win.getTitle?.() || win.title || "";
    if (!titleRaw) {
      return false;
    }

    // Check window bounds are valid
    const bounds = win.getBounds();
    if (!bounds || bounds.width <= 1 || bounds.height <= 1) {
      return false;
    }

    // Check if window is minimized
    if (win.isMinimized?.()) {
      return false;
    }

    const visibleFlag = win.isVisible?.();
    if (visibleFlag === false) {
      return false;
    }

    const title = normTitle(titleRaw);
    const skipKeywords = /\b(HH|Hand History|Replay|Replayer)\b/i;
    if (skipKeywords.test(title)) {
      return false;
    }

    const excludedPrefixes = settings.excludeTitlePrefixes;
    if (Array.isArray(excludedPrefixes) && beginsWithOneCaseInsensitive(title, excludedPrefixes)) {
      return false;
    }

    const strictBeginsOnly = settings.strictBeginsOnly === true;

    // Rush & Cash windows must match strict table format (stakes present)
    const rushCashRegex = /Rush\s*&\s*Cash/i;
    if (rushCashRegex.test(title)) {
      if (!isStrictRushCashTableTitle(title)) {
        return false;
      }
      const stakes = parseStakes(title);
      if (stakes && stakes.big > 0) {
        return true;
      }
      return false;
    }

    if (!strictBeginsOnly) {
      // For regular poker tables: Check for stakes patterns only when strict matching is disabled
      const stakePatterns = [
        /\b\d+(?:\.\d{2})?\s*\/\s*\d+(?:\.\d{2})?\b/,  // Basic stakes pattern: 0.10/0.25, 1/2, etc.
        /\$\d+(?:\.\d{2})?\s*\/\s*\$\d+(?:\.\d{2})?\b/, // Dollar stakes: $0.10/$0.25, $1/$2
        /NL\s*\d+/i,  // No Limit pattern: NL25, NL50, etc.
      ];

      const hasStakesPattern = stakePatterns.some(pattern => pattern.test(title));

      if (hasStakesPattern) {
        const stakes = parseStakes(title);
        if (stakes && stakes.big > 0) {
          return true;
        }

        return false;
      }

      if (settings.colorTierRules?.enabled && colorTierRegex) {
        const colorMatch = title.match(colorTierRegex);
        if (colorMatch) {
          const stakes = parseStakes(title);
          if (!stakes) {
            return false;
          }
          const tierKey = colorMatch.groups?.tier?.toLowerCase() || "";
          const tierRule = settings.colorTierRules.tiers?.[tierKey];
          if (tierRule?.maxBigBlind != null) {
            if (stakes.big > tierRule.maxBigBlind + 1e-9) {
              if (!state.quietMode) {
                logVerbose(
                  `[DEBUG] Skipping ${title}: big blind $${stakes.big} exceeds ${tierRule.maxBigBlind} for tier "${tierKey}"`
                );
              }
              return false;
            }
          }
          if (!state.quietMode) {
            logVerbose(
              `[DEBUG] Matched ${colorMatch.groups?.game?.toUpperCase?.() || 'game'} ${colorMatch.groups?.tier} table (${title}) | Stakes ${stakes.small}/${stakes.big}${stakes.ante ? ` ante ${stakes.ante}` : ""}`
            );
          }
          return true;
        }
      }
    }

    // Simple matcher check
    const matchers = settings.matchers || [];
    for (const matcher of matchers) {
      const hasPrefixes = matcher.titlePrefixes?.length > 0;
      const matchesPrefix = hasPrefixes && beginsWithOne(title, matcher.titlePrefixes);
      const hasKeywords = matcher.titleKeywords?.length > 0;
      const matchesKeyword = hasKeywords && containsKeywords(title, matcher.titleKeywords);
      const titleMatches = strictBeginsOnly
        ? matchesPrefix
        : (matchesPrefix || matchesKeyword);

      if (!titleMatches) {
        continue;
      }
      
      // Get class name if available
      const className = win.getClassName?.() || win.className || win.getProcessName?.() || "";
      
      // If class requirements exist and we have a class name, verify it matches
      const needsClassMatch = Array.isArray(matcher.classIncludes) && matcher.classIncludes.length > 0;
      if (needsClassMatch) {
        const classNorm = className?.trim().toLowerCase();
        if (classNorm) {
          if (matcher.classIncludes.some((cls) => classNorm.includes(String(cls).toLowerCase()))) {
            logVerbose(`[DEBUG] Found table with class match: "${title}" (${matcher.name})`);
            return true;
          }
          continue;
        }
        if (!state.quietMode) {
          logVerbose(`[DEBUG] Class unavailable for "${title}" (${matcher.name}); skipping classIncludes filter`);
        }
      }

      logVerbose(`[DEBUG] Found table: "${title}" (${matcher.name})`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error("[DEBUG] Error in window detection:", error);
    return false;
  }
}

function findMatchingMatcher(win) {
  const matchers = settings.matchers || [];
  const title = normTitle(win.getTitle?.() || win.title || "");
  const strictBeginsOnly = settings.strictBeginsOnly === true;

  for (const matcher of matchers) {
    const hasPrefixes = matcher.titlePrefixes?.length > 0;
    const matchesPrefix = hasPrefixes && beginsWithOne(title, matcher.titlePrefixes);
    const hasKeywords = matcher.titleKeywords?.length > 0;
    const matchesKeyword = hasKeywords && containsKeywords(title, matcher.titleKeywords);
    const titleMatches = strictBeginsOnly ? matchesPrefix : matchesPrefix || matchesKeyword;
    if (!titleMatches) continue;

    const className = win.getClassName?.() || win.className || win.getProcessName?.() || "";
    const needsClassMatch = Array.isArray(matcher.classIncludes) && matcher.classIncludes.length > 0;
    if (needsClassMatch) {
      const classNorm = className?.trim().toLowerCase();
      if (classNorm && !matcher.classIncludes.some((cls) => classNorm.includes(String(cls).toLowerCase()))) {
        continue;
      }
    }
    return matcher;
  }
  return null;
}

function resolveOverlayPrefs(matcher) {
  const base = {
    stakesEnabled: settings.overlays?.stakesEnabled !== false,
    clockEnabled: settings.overlays?.clockEnabled !== false
  };
  if (!matcher?.overlays) return base;
  return {
    ...base,
    ...matcher.overlays
  };
}

const scanner = createScanner({
  windowManager,
  settings,
  state,
  logVerbose,
  isPokerWindow,
  findMatcher: findMatchingMatcher,
  resolveOverlayPrefs,
  overlays,
  overlayMisses,
  createOverlayFor,
  updateOverlayPosition,
  cleanupMissing,
  destroyOverlayById,
  triggerRollForTable
});
const { startScanner, stopScanner, isRunning: isScannerRunning } = scanner;

const trayManager = createTrayManager({
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
});
const { createTrayInstance, buildMenu: trayBuildMenu } = trayManager;

let quitFallbackTimer = null;

function requestQuit(reason = "tray") {
  if (isExplicitQuit) return;
  isExplicitQuit = true;
  console.log(`[app] Quit requested (${reason})`);
  try {
    app.quit();
  } catch (err) {
    console.error("[app] Quit failed:", err?.message || err);
  }
  if (!quitFallbackTimer) {
    quitFallbackTimer = setTimeout(() => {
      console.log("[app] Quit fallback: forcing exit");
      try { app.exit(0); } catch {}
    }, 1200);
  }
}

function startSessionTimer() { 
  if (sessionTimer) clearInterval(sessionTimer); 
  sessionTimer = setInterval(() => {
    if (pomodoroIsRunning) {
      // Count down Pomodoro timer
      if (pomodoroTimer > 0) {
        pomodoroTimer--;
      } else {
        // Timer finished - switch modes with notifications
        if (pomodoroMode === 'work') {
          console.log("[pomodoro] Work session finished! Starting break...");
          showNotification("Work Session Complete!", "Time for a 5-minute break!", true);
          playAlarmSound();
          startBreak();
        } else {
          console.log("[pomodoro] Break finished! Starting work session...");
          showNotification("? Break Complete!", "Time to get back to work for 25 minutes!", true);
          playAlarmSound();
          startPomodoro();
        }
      }
    } else {
      // Increment the regular session timer like an alarm clock
      sessionTimerValue++;
    }
    
  if (tray) {
    try {
      const tip = `Poker RNG — Tables: ${overlays.size} — Timer: ${getSessionTime()}`;
      tray.setToolTip(tip);
    } catch (e) {
      console.error("Failed to update tray tooltip:", e.message);
    }
  }
  }, 1000); // Update every second
}
function stopSessionTimer() { 
  if (sessionTimer) { 
    clearInterval(sessionTimer); 
    sessionTimer = null; 
  } 
}

function resetSessionTimer() {
  sessionTimerValue = 0;
  sessionStartTime = Date.now();
  console.log("[timer] Session timer reset to 00:00:00");
}

function startPomodoro() {
  pomodoroIsRunning = true;
  pomodoroMode = 'work';
  pomodoroTimer = 25 * 60; // 25 minutes
  console.log("[pomodoro] Started work session: 25:00");
  showNotification("Work Session Started!", "Focus for 25 minutes. Timer is running!", false);
}

function startBreak() {
  pomodoroIsRunning = true;
  pomodoroMode = 'break';
  pomodoroTimer = 5 * 60; // 5 minutes
  console.log("[pomodoro] Started break session: 05:00");
  showNotification("? Break Started!", "Take a 5-minute break. Timer is running!", false);
}

function stopPomodoro() {
  pomodoroIsRunning = false;
  console.log("[pomodoro] Stopped Pomodoro timer");
  showNotification("Pomodoro Stopped", "Timer has been stopped. You can restart anytime.", false);
}

function resetPomodoro() {
  pomodoroIsRunning = false;
  pomodoroMode = 'work';
  pomodoroTimer = 25 * 60;
  console.log("[pomodoro] Reset Pomodoro timer to 25:00");
}

function showNotification(title, body, sound = true) {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: title,
      body: body,
      icon: iconPath,
      sound: sound,
      urgency: 'critical'
    });
    
    notification.show();
    
    // Auto-close after 5 seconds
    setTimeout(() => {
      notification.close();
    }, 5000);
    
    console.log(`[notification] ${title}: ${body}`);
  } else {
    console.log(`[notification] Notifications not supported: ${title}: ${body}`);
  }
}

function playAlarmSound() {
  // Try to play a short beep sequence on each platform
  try {
    if (process.platform === 'win32') {
      exec('powershell -c "[console]::beep(800,500); [console]::beep(1000,500); [console]::beep(1200,500)"');
    }
    else if (process.platform === 'darwin') {
      exec('afplay /System/Library/Sounds/Ping.aiff');
    }
    else {
      exec('beep -f 800 -l 500 -n -f 1000 -l 500 -n -f 1200 -l 500');
    }
  } catch (e) {
    console.log("[alarm] Could not play sound:", e.message);
  }
}

function setAutoStart(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, args: [] });
}
function isAutoStartEnabled() { return !!app.getLoginItemSettings().openAtLogin; }

function getSessionTime() {
    const pad = (num) => num.toString().padStart(2, '0');
    if (pomodoroIsRunning) {
      const hours = Math.floor(pomodoroTimer / 3600);
      const minutes = Math.floor((pomodoroTimer % 3600) / 60);
      const seconds = pomodoroTimer % 60;
      const mode = pomodoroMode === 'work' ? 'WORK' : 'BREAK';
      return `${mode} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }

    const hours = Math.floor(sessionTimerValue / 3600);
    const minutes = Math.floor((sessionTimerValue % 3600) / 60);
    const seconds = sessionTimerValue % 60;
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

function getSessionTimeDetailed() {
  const now = Date.now();
  const sessionMs = now - sessionStartTime;
  const totalSeconds = Math.floor(sessionMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

function openIntervalSelector() {
  if (intervalSelectorWindow && !intervalSelectorWindow.isDestroyed()) {
    intervalSelectorWindow.focus();
    return;
  }

  intervalSelectorWindow = new BrowserWindow({
    width: 300,
    height: 140,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(app.getAppPath(), "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Create HTML content for the interval selector
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      margin: 0;
      padding: 15px;
      background: linear-gradient(135deg, #2c3e50, #34495e);
      color: white;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      border-radius: 10px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      overflow: hidden;
      height: 100vh;
      box-sizing: border-box;
    }
    .container {
      text-align: center;
    }
    .title {
      font-size: 14px;
      margin-bottom: 10px;
      font-weight: bold;
    }
    .slider-container {
      margin: 10px 0;
    }
    .slider {
      width: 100%;
      height: 6px;
      border-radius: 3px;
      background: #555;
      outline: none;
      -webkit-appearance: none;
    }
    .slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #3498db;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    .slider::-moz-range-thumb {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #3498db;
      cursor: pointer;
      border: none;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    .value-display {
      font-size: 18px;
      font-weight: bold;
      margin: 10px 0;
      color: #3498db;
    }
    .close-btn {
      background: #e74c3c;
      color: white;
      border: none;
      padding: 5px 15px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 12px;
    }
    .close-btn:hover {
      background: #c0392b;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="title">Auto-Roll Interval</div>
    <div class="slider-container">
      <input type="range" id="intervalSlider" class="slider" min="0" max="60" value="${state.currentAutoRollInterval}">
    </div>
    <div class="value-display" id="valueDisplay">${state.currentAutoRollInterval > 0 ? state.currentAutoRollInterval + 's' : 'turn-based'}</div>
    <button class="close-btn" onclick="window.close()">Close</button>
  </div>

  <script>
    const slider = document.getElementById('intervalSlider');
    const valueDisplay = document.getElementById('valueDisplay');
    
    slider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value, 10);
      valueDisplay.textContent = value > 0 ? (value + 's') : 'turn-based';
      
      // Send the new value to the main process
      if (window.rng?.setInterval) {
        window.rng.setInterval(value);
      }
    });
    
    // Close window when clicking outside
    document.addEventListener('click', (e) => {
      if (e.target === document.body) {
        window.close();
      }
    });
  </script>
</body>
</html>`;

  intervalSelectorWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
  
  intervalSelectorWindow.once("ready-to-show", () => {
    intervalSelectorWindow.show();
  });

  intervalSelectorWindow.on("closed", () => {
    intervalSelectorWindow = null;
  });
}

function currentSettingsPayload() {
  const scanMs = Math.max(120, Number(settings.scanMs) || 300);
  return {
    quietMode: state.quietMode,
    autoStartEnabled: settings.autoStartEnabled === true,
    scanMs,
    showOnlyActiveTables: state.showOnlyActiveTables,
    turnRecognitionEnabled: settings.turnRecognition?.enabled === true,
    autoRollSeconds: state.currentAutoRollInterval,
    showStakesOverlay: settings.overlays?.stakesEnabled !== false,
    showClockOverlay: settings.overlays?.clockEnabled !== false
  };
}

function broadcastSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    try {
      settingsWindow.webContents.send("settings:updated", currentSettingsPayload());
    } catch (err) {
      console.error("[settings] Failed to broadcast to settings window:", err.message);
    }
  }
}

function applySettingsPatch(patch = {}) {
  if (!patch || typeof patch !== "object") {
    return currentSettingsPayload();
  }

  let scannerNeedsRestart = false;
  let settingsChanged = false;
  let menuNeedsRefresh = false;

  if (patch.openSettings) {
    openSettingsWindow();
  }

  if ("quietMode" in patch) {
    const nextQuiet = !!patch.quietMode;
    if (nextQuiet !== state.quietMode) {
      state.quietMode = nextQuiet;
      settings.quietMode = state.quietMode;
      settingsChanged = true;
      menuNeedsRefresh = true;
    }
  }

  if ("autoStartEnabled" in patch) {
    const nextAutoStart = !!patch.autoStartEnabled;
    if (nextAutoStart !== (settings.autoStartEnabled === true)) {
      settings.autoStartEnabled = nextAutoStart;
      setAutoStart(nextAutoStart);
      settingsChanged = true;
      menuNeedsRefresh = true;
    }
  }

  if ("showOnlyActiveTables" in patch) {
    const nextActiveOnly = !!patch.showOnlyActiveTables;
    if (nextActiveOnly !== state.showOnlyActiveTables) {
      state.showOnlyActiveTables = nextActiveOnly;
      settings.showOnlyActiveTables = state.showOnlyActiveTables;
      settingsChanged = true;
      menuNeedsRefresh = true;
      refreshAllOverlayPositions("active-only-toggle");
    }
  }

  if ("scanMs" in patch) {
    const nextScan = Math.max(120, Number(patch.scanMs) || 300);
    const currentScan = Math.max(120, Number(settings.scanMs) || 300);
    if (nextScan !== currentScan) {
      settings.scanMs = nextScan;
      scannerNeedsRestart = true;
      settingsChanged = true;
    }
  }

  if ("turnRecognitionEnabled" in patch) {
    const nextTurn = !!patch.turnRecognitionEnabled;
    const prevTurn = settings.turnRecognition?.enabled === true;
    if (nextTurn !== prevTurn) {
      settings.turnRecognition = {
        ...defaultTurnRecognition,
        ...settings.turnRecognition,
        enabled: nextTurn
      };
      settingsChanged = true;
      for (const entry of overlays.values()) {
        entry.turnRecognitionMatched = false;
      }
    }
  }

  if ("autoRollSeconds" in patch) {
    setAutoRollInterval(patch.autoRollSeconds);
  }

  if ("showStakesOverlay" in patch) {
    const next = !!patch.showStakesOverlay;
    if (settings.overlays.stakesEnabled !== next) {
      settings.overlays.stakesEnabled = next;
      settingsChanged = true;
      refreshOverlayFeatures();
    }
  }

  if ("showClockOverlay" in patch) {
    const next = !!patch.showClockOverlay;
    if (settings.overlays.clockEnabled !== next) {
      settings.overlays.clockEnabled = next;
      settingsChanged = true;
      refreshOverlayFeatures();
    }
  }

  if (settingsChanged) {
    persistSettingsSnapshot(settings, "settings update");
  }

  if (scannerNeedsRestart) {
    startScanner();
  }

  if (menuNeedsRefresh && tray) {
    try {
      tray.setContextMenu(trayBuildMenu());
    } catch (err) {
      console.error("[settings] Failed to refresh tray menu:", err.message);
    }
  }

  broadcastSettings();
  return currentSettingsPayload();
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 420,
    height: 520,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    show: false,
    frame: true,
    transparent: false,
    backgroundColor: "#0f121e",
    webPreferences: {
      preload: path.join(app.getAppPath(), "settings-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.removeMenu?.();
  settingsWindow.loadFile(path.join(app.getAppPath(), "settings.html")).catch((err) => {
    console.error("[settings] Failed to load settings UI:", err.message);
  });

  settingsWindow.once("ready-to-show", () => {
    settingsWindow.show();
    broadcastSettings();
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

ipcMain.handle("settings:get", () => currentSettingsPayload());
ipcMain.handle("settings:update", (_event, patch) => applySettingsPatch(patch || {}));

function registerShortcuts() {
  try {
    const registered = globalShortcut.register("Alt+H", () => {
      state.overlaysManuallyHidden = !state.overlaysManuallyHidden;
      console.log(`[ALT+H] Toggled to: ${state.overlaysManuallyHidden ? 'HIDDEN' : 'VISIBLE'}`);
      
      // Immediately apply visibility change to all overlays
      for (const [id, entry] of overlays) {
        try {
          if (state.overlaysManuallyHidden) {
            // Hide all overlays
            entry.bw.hide();
            if (entry.stakesBw && !entry.stakesBw.isDestroyed()) entry.stakesBw.hide();
            if (entry.clockBw && !entry.clockBw.isDestroyed()) entry.clockBw.hide();
            console.log(`[ALT+H] ❌ Hid overlay for table ${id}`);
          } else {
            // Show all overlays (only if table is visible and not minimized)
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
                console.log(`[ALT+H] ✅ Showed overlay for table ${id}`);
              } else if (!activeAllowed) {
                console.log(`[ALT+H] Skipped overlay for table ${id} (inactive table hidden)`);
              } else if (tableVisible === false) {
                console.log(`[ALT+H] Skipped overlay for table ${id} (table not visible)`);
              }
            } catch (e) {
              console.error(`[ALT+H] Failed to check table visibility for ${id}:`, e.message);
            }
          }
        } catch (e) {
          console.error(`[ALT+H] Failed to toggle overlay ${id}:`, e.message);
        }
      }
    });
    
    // Add Ctrl+Alt+R to force cleanup all overlays
    globalShortcut.register("Ctrl+Alt+R", () => {
      console.log("[shortcut] Force cleanup all overlays");
      for (const id of Array.from(overlays.keys())) {
        destroyOverlayById(id, "shortcut-clear");
      }
      console.log("[shortcut] All overlays cleared");
    });
    
    if (registered) {
      console.log("[SHORTCUT] ✅ Alt+H registered successfully");
    } else {
      console.log("[SHORTCUT] ❌ Alt+H registration FAILED - another app may be using it");
    }
    
  } catch (e) { console.error("Shortcut registration failed", e); }
}

const singleInstanceLock = app.requestSingleInstanceLock();
console.log("[app] singleInstanceLock:", singleInstanceLock);

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    for (const { bw } of overlays.values()) {
      try { bw.moveTop(); } catch {}
    }
  });

  app.on("window-all-closed", (e) => {
    if (!isExplicitQuit) {
      e.preventDefault();
    }
  });

  app.whenReady().then(() => {
    console.log("[app] whenReady()");
    app.setAppUserModelId("PokerRNG");

    // Handle IPC messages
    ipcMain.on("set-auto-roll-interval", (event, seconds) => {
      setAutoRollInterval(seconds);
    });

    console.log("[app] setAutoStart begin");
    setAutoStart(settings.autoStartEnabled === true);
    console.log("[app] startScanner begin");
    startScanner();
    console.log("[app] startSessionTimer begin");
    startSessionTimer();
    console.log("[app] createTray begin");
    tray = createTrayInstance({ requestQuit });
    console.log("[app] registerShortcuts begin");
    registerShortcuts();
    console.log("[app] startup complete");
  }).catch((err) => {
    console.error("[app] whenReady error:", err);
  });
}

app.on("will-quit", (event) => {
  console.log("[app] Will quit event triggered");
  if (quitFallbackTimer) {
    clearTimeout(quitFallbackTimer);
    quitFallbackTimer = null;
  }
  // Ensure all windows are torn down
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.destroy(); } catch {}
    }
  } catch {}
  stopScanner();
  stopSessionTimer();
  globalShortcut.unregisterAll();
  
  // Destroy all overlays (main, stakes, clock)
  for (const entry of overlays.values()) {
    try { if (entry.bw) entry.bw.destroy(); } catch {}
    try { if (entry.stakesBw) entry.stakesBw.destroy(); } catch {}
    try { if (entry.clockBw) entry.clockBw.destroy(); } catch {}
  }
  overlays.clear();
  
  if (intervalSelectorWindow && !intervalSelectorWindow.isDestroyed()) {
    try { intervalSelectorWindow.destroy(); } catch {}
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    try { settingsWindow.destroy(); } catch {}
  }
  if (tray) {
    try { tray.destroy(); } catch {}
  }
});

// Also handle before-quit for more control
app.on("before-quit", (event) => {
  console.log("[app] Before quit event triggered");
  isExplicitQuit = true;
  // Allow the quit to proceed
});
