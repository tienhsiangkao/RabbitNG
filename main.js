import { timerSeconds } from "./src/timer-settings.js";
import { applyAutomaticDefaults } from './src/automatic-defaults.js';
import { normalizeAppearance, patchAppearance,applyThinBorderDefaults } from './src/appearance-settings.js';
import { normalizeComfort, SessionComfort, sharedClockRect, defaultClockPosition } from './src/session-comfort.js';
import {buildSessionTrayItems} from './src/session-tray-menu.js';
import {normalizeSessionFocus,saveSessionFocusPatch} from './src/session-focus.js';
import {sessionFocusRect} from './src/session-focus-layout.js';
import {ownedPanelLayout} from './src/owned-panel-layout.js';
import {SessionFocusPanel} from './src/session-focus-panel.js';
import {isGgProcess,classifyPokerUtility} from './src/poker-workspace.js';
import {LayoutStabilityJournal} from './src/layout-stability.js';
import { FocusWindows } from './src/focus-windows.js';
// Overlays + autostart + tray
import path from "path";
import { dedupeTableWindows, samePhysicalTable } from "./src/window-dedupe.js";
import {
  isBrowserWindow,
  isCoinPokerContainerWindow,
  isKnownNonTablePokerWindowTitle,
  isKnownPokerClientWindow
} from "./src/window-classifier.js";
import { updateUnmatchedTableMisses } from "./src/overlay-retention.js";
import { anchorsEqual, normalizedAnchorFromRect } from "./src/overlay-position.js";
import { rngOverlaySize, normalizeRngSizing, auxiliaryOverlayLayout, heroHandOverlayRect } from "./src/overlay-sizing.js";
import { isPokerTableWindowEffectivelyVisible as nativeTableVisible, hideOverlayWindows } from "./src/window-visibility.js";
import { computeOverlayPlacement, nativeBoundsToDip } from "./src/window-occlusion.js";
import { parseStakes, stakeBadgeForTitle } from "./src/table-stakes.js";
import { tableFrameLayout } from "./src/table-frame-layout.js";
import {
  createLayoutProfile,
  deleteLayoutProfile,
  getActiveLayoutProfile,
  normalizeTableLayoutSettings,
  upsertLayoutProfile
} from "./src/table-layout.js";
import { TableLayoutManager } from "./src/table-layout-manager.js";
import {WorkspaceManager} from './src/workspace-manager.js';
import {AutomaticPokerWorkspace} from './src/automatic-poker-workspace.js';
import {SixShelfWorkspace} from './src/six-shelf-workspace.js';
import {preparePokerLayoutScan} from './src/poker-layout-scan.js';
import fs from "fs";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { randomInt } from "crypto";
import { createRngRoll, commitRngRoll } from "./src/rng-state.js";

const require = createRequire(import.meta.url);
const simulation=globalThis[Symbol.for('PokerRNG.simulation')]||null;
const liveTest=globalThis[Symbol.for('PokerRNG.liveTest')]||null;
const isolatedRun=simulation||liveTest;
const layoutStability=new LayoutStabilityJournal();
const electron=require('electron');
const {
  app,
  Tray,
  Menu,
  nativeImage,
  ipcMain
} = electron;
const BrowserWindow=simulation?.BrowserWindow||electron.BrowserWindow;
const globalShortcut=isolatedRun?.globalShortcut||electron.globalShortcut;
const screen=simulation?.screen||electron.screen;
const nativeWindowManager=simulation?null:require('node-window-manager').windowManager;
const windowManager=simulation?.windowManager||(liveTest?liveTest.wrapWindowManager(nativeWindowManager):nativeWindowManager);
const readWindowDisplayState=simulation?simulation.readDisplayState:
  (await import('./src/windows-display-state.js')).createWindowDisplayStateReader();
const createWindowsFocusAdapter=isolatedRun?()=>isolatedRun.focusAdapter:
  (await import('./src/windows-focus-adapter.js')).createWindowsFocusAdapter;
const overlayPanelCss = fs.readFileSync(path.join(app.getAppPath(), 'src', 'overlay-panel.css'), 'utf8');

const packagedSettingsPath = path.join(app.getAppPath(), "settings.json");
let userSettingsPath = packagedSettingsPath;
try {
  userSettingsPath = path.join(app.getPath("userData"), "settings.json");
} catch (err) {
  console.error("[settings] Unable to resolve userData path; settings will fall back to packaged defaults:", err.message);
}
const canPersistUserSettings = userSettingsPath !== packagedSettingsPath;

function ensureUserSettingsDir() {
  if (!canPersistUserSettings) return;
  try {
    fs.mkdirSync(path.dirname(userSettingsPath), { recursive: true });
  } catch (err) {
    if (err.code !== "EEXIST") {
      throw err;
    }
  }
}

function readSettingsFile(filePath, label) {
  if (!filePath) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`[settings] Failed to read ${label}:`, err.message);
    }
    return null;
  }
}

function loadSettingsSnapshot() {
  const existing = canPersistUserSettings
    ? readSettingsFile(userSettingsPath, "user settings")
    : null;
  if (existing) {
    return existing;
  }

  const packaged = readSettingsFile(packagedSettingsPath, "packaged settings");
  if (packaged && canPersistUserSettings) {
    try {
      ensureUserSettingsDir();
      fs.writeFileSync(userSettingsPath, JSON.stringify(packaged, null, 2), "utf8");
    } catch (err) {
      console.error("[settings] Failed to seed user settings file:", err.message);
    }
  }
  return packaged || {};
}

function persistSettingsSnapshot(settingsObj, context = "settings") {
  if (!canPersistUserSettings) {
    console.error("[settings] Cannot persist settings: userData path unavailable");
    return;
  }
  try {
    ensureUserSettingsDir();
    fs.writeFileSync(userSettingsPath, JSON.stringify(settingsObj, null, 2), "utf8");
  } catch (err) {
    console.error(`Failed to save ${context}:`, err.message);
  }
}

const overlays = new Map();
const overlayMisses = new Map(); // consecutive native-window misses per table id
const OVERLAY_DESTROY_MISS_THRESHOLD = 6;
const overlayTableMisses = new Map(); // consecutive scans where native window exists but is no longer a poker table
const OVERLAY_TABLE_MISS_THRESHOLD = 6;
const PROGRAMMATIC_MOVE_SUPPRESS_MS = 1200;
let scanTimer = null;
let sessionTimer = null; // Timer to update session time
let tray = null;
let quietMode = true; // Reduce logging by default
const logVerbose = (...args) => {
  if (!quietMode) {
    console.log(...args);
  }
};
let workspacePlan=null,workspacePlanKey='',workspaceClockManual=false,sharedClockProgrammaticBounds=null;
const pokerWorkspace=liveTest?new SixShelfWorkspace():new AutomaticPokerWorkspace();
const realWorkspaceAdapter=simulation?null:(await import('./src/windows-workspace-adapter.js')).createWindowsWorkspaceAdapter();
const livePhysicalPlacer=liveTest?(await import('./src/windows-live-placement.js')).createWindowsLivePhysicalPlacer():null;
const workspaceAdapter=simulation?.workspaceAdapter||(liveTest?liveTest.wrapAdapter(realWorkspaceAdapter,readWindowDisplayState,livePhysicalPlacer):realWorkspaceAdapter);
const workspaceManager=new WorkspaceManager({adapter:workspaceAdapter,error:error=>console.error('[workspace]',error.message)});
const tableLayoutManager = new TableLayoutManager({
  windowManager,
  canMove:win=>workspaceAdapter.visible(win),
  isDragging:()=>workspaceAdapter.isDragging?.()===true,
  getLayoutWorkArea:monitor=>workspacePlan&&monitor.primary?workspacePlan.tableArea:monitor.workArea,
  getLayoutTargets:(monitor,ordered)=>workspacePlan&&monitor.primary?
    (pokerWorkspace.active?pokerWorkspace.targetsFor(ordered):workspacePlan.tableRects):undefined,
  log: (...args) => logVerbose(...args),
  error: (...args) => console.error(...args)
});
let showOnlyActiveTables = false; // Show overlays for all visible tables (like attached to table)
let overlaysManuallyHidden = false; // Track if overlays were manually hidden
let currentAutoRollInterval = 3; // Timed refresh in seconds
let intervalSelectorWindow = null; // Window for interval selector
let settingsWindow = null; // Settings UI
let currentFocusedTableId = null; // Active poker table this scan
let lastActiveTableId = null; // Track the previous focused table for turn detection
let scanRunning = false; // Prevent concurrent scan ticks
let scanRerunRequested = false;
let appShuttingDown = false;
let lastOcclusionMap = new Map();
let lastOverlayPlacements = new Map();
let lastFrameBlockers = new Map();
let frameDiagnosticsTimer = null;
let overlayAnchorPersistTimer = null;
let dragRefreshTimer = null;
let sharedClockWindow=null, sharedClockReady=false, sharedClockMoveTimer=null;
let sessionFocusPanel=null,sessionFocusContext=null,sessionFocusPlacementKey='';
let comfortSessionActive=false;
let lastComfortBreakPhase=null;
const comfortSession=new SessionComfort();
simulation?.registerComfortSession?.(comfortSession);
let focusWindows=null,focusError='';
const focusJournalPath=path.join(path.dirname(userSettingsPath),'focus-windows.json');

// Load settings
let settings = applyThinBorderDefaults(applyAutomaticDefaults(loadSettingsSnapshot()));
settings.workspace={enabled:settings.workspace?.enabled!==false};
settings.appearance=normalizeAppearance(settings.appearance);
settings.comfort=normalizeComfort(settings.comfort);
settings.sessionFocus=normalizeSessionFocus(settings.sessionFocus);
settings.overlays = settings.overlays || {};
settings.overlays.stakeFrameEnabled ??= true;
const normalizedSizing = normalizeRngSizing(settings.overlays);
if (JSON.stringify(normalizedSizing) !== JSON.stringify(settings.overlays)) {
  settings.overlays = normalizedSizing;
  persistSettingsSnapshot(settings, 'proportional RNG sizing');
}
const normalizedTableLayout = normalizeTableLayoutSettings(settings.tableLayout);
if (JSON.stringify(settings.tableLayout) !== JSON.stringify(normalizedTableLayout)) {
  settings.tableLayout = normalizedTableLayout;
  persistSettingsSnapshot(settings, "table layout defaults");
} else {
  settings.tableLayout = normalizedTableLayout;
}
if (typeof settings.overlays.rememberDefaultOnDrag !== "boolean") {
  settings.overlays.rememberDefaultOnDrag = true;
  persistSettingsSnapshot(settings, "RNG drag persistence default");
}
if (settings.overlays.dragOffset) {
  delete settings.overlays.dragOffset;
  persistSettingsSnapshot(settings, "normalized RNG overlay position");
}
quietMode = settings.quietMode !== false; // Default to true unless explicitly false
currentAutoRollInterval = timerSeconds(Number(settings.autoRollMs) / 1000);
settings.autoRollMs = currentAutoRollInterval * 1000;
// Timer-only edition ignores and removes legacy screenshot recognition settings.
if ('turnRecognition' in settings) delete settings.turnRecognition;
persistSettingsSnapshot(settings, 'timer-only settings');
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
  showOnlyActiveTables = settings.showOnlyActiveTables;
} else {
  settings.showOnlyActiveTables = showOnlyActiveTables;
  persistSettingsSnapshot(settings, "settings defaults");
}

const defaultColorTierRules = {
  enabled: true,
  tiers: {
    red: { maxBigBlind: 0.25 },
    gold: { maxBigBlind: 5 },
    platinum: { maxBigBlind: 10 },
    diamond: { maxBigBlind: 20 }
  }
};

function mergeColorTierRules(existing = {}) {
  const merged = {
    ...defaultColorTierRules,
    ...existing,
    tiers: { ...defaultColorTierRules.tiers }
  };
  if (existing.tiers) {
    for (const [key, value] of Object.entries(existing.tiers)) {
      if (!key) continue;
      merged.tiers[key.toLowerCase()] = {
        ...merged.tiers[key.toLowerCase()] || {},
        ...value
      };
    }
  }
  return merged;
}

settings.colorTierRules = mergeColorTierRules(settings.colorTierRules);

if (!Array.isArray(settings.excludeTitlePrefixes)) {
  settings.excludeTitlePrefixes = [];
}

if (!Array.isArray(settings.excludeTitleKeywords)) {
  settings.excludeTitleKeywords = [];
  persistSettingsSnapshot(settings, "window title exclusion defaults");
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let colorTierRegex = null;
function buildColorTierRegex() {
  const config = settings.colorTierRules;
  if (!config?.tiers) {
    colorTierRegex = null;
    return;
  }
  const names = Object.keys(config.tiers).filter(Boolean);
  if (names.length === 0) {
    colorTierRegex = null;
    return;
  }
  const namePattern = names.map(escapeRegExp).join("|");
  colorTierRegex = new RegExp(
    `^\\[#\\]\\s*(?<game>NLH|NLHA|PLO|PLOA)\\s+(?<tier>${namePattern})\\s+(?<table>\\d{1,3})\\s+-\\s*\\$\\d+(?:\\.\\d{2})?\\s*/\\s*\\$\\d+(?:\\.\\d{2})?(?:\\s*\\(\\$\\d+(?:\\.\\d{2})?\\))?\\s*\\[#\\]$`,
    "i"
  );
}

buildColorTierRegex();

const isDev = !app.isPackaged;
const iconPath = isDev
  ? path.join(app.getAppPath(), "assets", "icons", "app.ico")
  : path.join(process.resourcesPath, "assets", "icons", "app.ico");

try { logVerbose("Tray icon path:", iconPath, "exists:", fs.existsSync(iconPath)); } catch {}

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

function configuredPokerClassIncludes() {
  const values = [];
  for (const matcher of settings.matchers || []) {
    if (Array.isArray(matcher?.classIncludes)) {
      values.push(...matcher.classIncludes);
    }
  }
  return values;
}

function isPokerWindow(win) {
  try {
    if (isBrowserWindow(win)) {
      return false;
    }

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

    const knownPokerClient = isKnownPokerClientWindow(win, {
      classIncludes: configuredPokerClassIncludes()
    });
    if (!knownPokerClient) {
      return false;
    }
    if(!workspaceAdapter.visible(win))return false;

    if (!isPokerTableWindowEffectivelyVisible(win, { knownPokerClient })) {
      return false;
    }

    // CoinPoker exposes each live table through a Unity container whose title
    // is only "CoinPoker". Attach to that verified child executable and skip
    // the normal stakes/title matching below; the separate lobby stays ignored.
    if (isCoinPokerContainerWindow(win)) {
      return true;
    }

    const title = normTitle(titleRaw);
    if (isKnownNonTablePokerWindowTitle(title, {
      prefixes: settings.excludeTitlePrefixes,
      keywords: settings.excludeTitleKeywords
    })) {
      logVerbose(`[scan] Rejected non-table poker window: "${title}"`);
      return false;
    }

    // For Rush & Cash tables: ULTRA STRICT matching - only specific format with spaces around slash
    const rushCashRegex = /Rush\s*&\s*Cash/i;
    
    if (rushCashRegex.test(title)) {
      // ULTRA STRICT: Must have EXACT format with spaces around slash: "$0.25 / $0.50" or "0.10 / 0.25"
      // YES: "[#] Rush & Cash $0.25 / $0.50 [#]", "Rush & Cash $0.10 / $0.25", "[#] Rush & Cash - $0.25 / $0.50 [#]"
      // NO:  "Rush & Cash 0.10/0.25 Table 42", "Rush & Cash $1/$2 - Fast Fold"
      const strictStakesPattern = /(?:\$?\d+(?:\.\d{2})?\s+\/\s+\$?\d+(?:\.\d{2})?)/;
      const hasStrictStakes = strictStakesPattern.test(title);
      
      if (!hasStrictStakes) {
        return false;
      }
      
      // Extract and validate stakes
      const stakes = parseStakes(title);
      if (stakes && stakes.big > 0) {
        return true;
      }

      return false;
    }

    // For regular poker tables: Check for stakes patterns
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
            if (!quietMode) {
              logVerbose(
                `[DEBUG] Skipping ${title}: big blind $${stakes.big} exceeds ${tierRule.maxBigBlind} for tier "${tierKey}"`
              );
            }
            return false;
          }
        }
        if (!quietMode) {
          logVerbose(
            `[DEBUG] Matched ${colorMatch.groups?.game?.toUpperCase?.() || 'game'} ${colorMatch.groups?.tier} table (${title}) | Stakes ${stakes.small}/${stakes.big}${stakes.ante ? ` ante ${stakes.ante}` : ""}`
          );
        }
        return true;
      }
    }

    const strictBeginsOnly = settings.strictBeginsOnly === true;

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
        if (!quietMode) {
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

function getTableBounds(win) { return nativeBoundsToDip(win, (bounds) => screen.screenToDipRect(null, bounds)); }

function isPokerTableWindowEffectivelyVisible(win) {
  if (!nativeTableVisible(win)) return false;
  try {
    const b = getTableBounds(win);
    return screen.getAllDisplays().some(({ bounds: d }) => b.x < d.x + d.width &&
      b.x + b.width > d.x && b.y < d.y + d.height && b.y + b.height > d.y);
  } catch { return false; }
}

function bufferHandleKey(buf) {
  if (!buf || typeof buf.length !== "number") return null;
  try {
    if (typeof buf.readBigUInt64LE === "function" && buf.length >= 8) {
      return buf.readBigUInt64LE(0).toString();
    }
    if (buf.length >= 4) {
      return BigInt(buf.readUInt32LE(0)).toString();
    }
  } catch {}
  return null;
}

function getBrowserWindowHandleKey(bw) {
  if (!bw || typeof bw.getNativeWindowHandle !== "function") return null;
  try {
    const handle = bw.getNativeWindowHandle();
    return bufferHandleKey(handle);
  } catch {
    return null;
  }
}

function collectOverlayHandleKeys() {
  const handles = new Set();
  const sharedHandle=getBrowserWindowHandleKey(sharedClockWindow);
  if(sharedHandle)handles.add(sharedHandle);
  const focusHandle=getBrowserWindowHandleKey(sessionFocusPanel?.window);
  if(focusHandle)handles.add(focusHandle);
  for (const entry of overlays.values()) {
    if (entry.nativeIdKey) handles.add(entry.nativeIdKey);
    if (entry.stakesNativeIdKey) handles.add(entry.stakesNativeIdKey);
    if (entry.clockNativeIdKey) handles.add(entry.clockNativeIdKey);
    if (entry.frameNativeIdKey) handles.add(entry.frameNativeIdKey);
  }
  return handles;
}

function computeOcclusionMap(windowList, canonicalIdById = null) {
  if (!canonicalIdById) {
    canonicalIdById = dedupeTableWindows(windowList.filter(isPokerWindow), new Set(overlays.keys())).canonicalIdById;
  }
  const result = computeOverlayPlacement(windowList, {
    ignoreIds: collectOverlayHandleKeys(), canonicalIdById, getBounds: getTableBounds, getOverlayRect: overlayRectFor,
    getDisplayState: readWindowDisplayState
  });
  lastOverlayPlacements = result.placements;
  lastFrameBlockers = result.blockersById;
  return result.occluded;
}

function overlayBaseRectFor(b) {
  const overlayConfig = settings.overlays || {};
  const { width, height } = rngOverlaySize(overlayConfig, b, settings.appearance);
  
  // Use configured positioning - prioritize anchor over edge
  const position = overlayConfig.position || {};
  const anchor = overlayConfig.anchor || { xPct: 0.343, yPct: 0.72 };
  const mode = position.mode || "hero-hand";
  const edge = position.edge || "top-right";
  const padX = position.padX || 24;
  const padY = position.padY || 24;
  
  let x, y;
  
  if (mode === "hero-hand") {
    return heroHandOverlayRect(overlayConfig, b, settings.appearance);
  } else if (mode === "anchor") {
    // Anchor-based positioning (preferred)
    x = b.x + Math.floor(b.width * anchor.xPct);
    y = b.y + Math.floor(b.height * anchor.yPct);
  } else if (mode === "edge") {
    // Edge-based positioning
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
    // Default to anchor-based when mode is unrecognized
    x = b.x + Math.floor(b.width * anchor.xPct);
    y = b.y + Math.floor(b.height * anchor.yPct);
  }
  
  // Ensure position is within table bounds
  const maxX = b.x + b.width - width;
  const maxY = b.y + b.height - height;
  x = Math.max(b.x, Math.min(maxX, x));
  y = Math.max(b.y, Math.min(maxY, y));
  
  if (!quietMode) {
    const positioningMethod = mode === "edge"
      ? `edge(${edge})`
      : `anchor(${anchor.xPct},${anchor.yPct})`;
    logVerbose(`[overlay] Config-based sizing: ${width}x${height} at ${positioningMethod} (table: ${b.width}x${b.height})`);
  }
  
  return { 
    x, 
    y, 
    width, 
    height 
  };
}

function clampOverlayRectToTable(rect, tableBounds) {
  if (!rect || !tableBounds) return rect;

  const numberOr = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const width = Math.max(1, Math.round(numberOr(rect.width, 1)));
  const height = Math.max(1, Math.round(numberOr(rect.height, 1)));
  const tableX = Math.round(numberOr(tableBounds.x, 0));
  const tableY = Math.round(numberOr(tableBounds.y, 0));
  const tableWidth = Math.max(1, Math.round(numberOr(tableBounds.width, 1)));
  const tableHeight = Math.max(1, Math.round(numberOr(tableBounds.height, 1)));
  const maxX = Math.max(tableX, tableX + tableWidth - width);
  const maxY = Math.max(tableY, tableY + tableHeight - height);

  return {
    ...rect,
    width,
    height,
    x: Math.max(tableX, Math.min(maxX, Math.round(numberOr(rect.x, tableX)))),
    y: Math.max(tableY, Math.min(maxY, Math.round(numberOr(rect.y, tableY))))
  };
}

function overlayRectFor(b) {
  const base = overlayBaseRectFor(b);
  return clampOverlayRectToTable(base, b);
}

function boundsMatch(a, b, tolerance = 1) {
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

function tableSnapshotFromEntry(entry) {
  if (!entry?.lastTitle || !entry?.lastTableBounds) return null;
  return {
    id: entry.tableId,
    getTitle: () => entry.lastTitle,
    getBounds: () => ({ ...entry.lastTableBounds })
  };
}

function getOverlayRecord(id, sourceBw = null) {
  let entry = overlays.get(id);
  if (sourceBw && entry?.bw !== sourceBw) {
    entry = null;
  }
  if (!entry && sourceBw) {
    for (const [candidateId, candidate] of overlays) {
      if (candidate?.bw === sourceBw) {
        return { id: candidateId, entry: candidate };
      }
    }
  }
  return entry ? { id, entry } : null;
}

function findOverlayIdForTableWindow(win) {
  for (const [id, entry] of overlays) {
    if (id === win.id) continue;

    const snapshot = tableSnapshotFromEntry(entry);
    if (snapshot) {
      try {
        if (samePhysicalTable(win, snapshot)) {
          return id;
        }
      } catch {}
    }

    if (entry?.tableWin) {
      try {
        if (samePhysicalTable(win, entry.tableWin)) {
          return id;
        }
      } catch {}
    }
  }
  return null;
}

function adoptOverlayForWindow(win) {
  const existingId = findOverlayIdForTableWindow(win);
  if (existingId == null) return false;

  const entry = overlays.get(existingId);
  if (!entry?.bw || entry.bw.isDestroyed?.()) {
    destroyOverlayById(existingId, "stale-adopted-overlay");
    return false;
  }

  if (overlays.has(win.id) && overlays.get(win.id) !== entry) {
    destroyOverlayById(win.id, "replaced-by-adopted-overlay");
  }

  // Overlay similarity is not proof that a live table reservation changed owner.
  if(!pokerWorkspace.active)tableLayoutManager.migrateWindowId(existingId, win.id);
  overlays.delete(existingId);
  overlayMisses.delete(existingId);
  overlayTableMisses.delete(existingId);
  overlays.set(win.id, entry);
  overlayMisses.delete(win.id);
  overlayTableMisses.delete(win.id);

  const title = win.getTitle?.() || win.title || entry.lastTitle || "";
  const tableBounds = getTableBounds(win);
  entry.tableId = win.id;
  entry.tableWin = win;
  entry.lastTitle = title;
  entry.lastTableBounds = { ...tableBounds };
  entry.programmaticMoveUntil = Date.now() + PROGRAMMATIC_MOVE_SUPPRESS_MS;

  logVerbose(`[overlay] Adopted overlay ${existingId} -> ${win.id} for "${title}"`);
  return true;
}

function scheduleOverlayAnchorPersist() {
  if (overlayAnchorPersistTimer) clearTimeout(overlayAnchorPersistTimer);
  overlayAnchorPersistTimer = setTimeout(() => {
    overlayAnchorPersistTimer = null;
    persistSettingsSnapshot(settings, "RNG overlay position");
  }, 300);
}

function scheduleOverlayAnchorRefresh(sourceId) {
  if (dragRefreshTimer) clearTimeout(dragRefreshTimer);
  dragRefreshTimer = setTimeout(() => {
    dragRefreshTimer = null;
    for (const [id, entry] of overlays) {
      if (id === sourceId || !entry.tableWin) continue;
      try {
        updateOverlayPosition(entry.tableWin, lastOcclusionMap);
      } catch (err) {
        console.error(`[overlay] Failed to apply saved overlay position to ${id}:`, err.message);
      }
    }
  }, 120);
}

function handleRngOverlayMove(id, sourceBw = null) {
  if (settings.overlays?.rememberDefaultOnDrag !== true) return;
  const record = getOverlayRecord(id, sourceBw);
  if (!record?.entry?.bw || record.entry.bw.isDestroyed?.()) return;
  id = record.id;
  const entry = record.entry;

  let currentBounds;
  let tableBounds;
  try {
    currentBounds = entry.bw.getBounds();
    tableBounds = getTableBounds(entry.tableWin);
  } catch {
    return;
  }

  if (entry.programmaticMoveUntil > Date.now()) {
    entry.lastBounds = { ...currentBounds };
    return;
  }

  const constrainedBounds = clampOverlayRectToTable(currentBounds, tableBounds);
  const nextAnchor = normalizedAnchorFromRect(constrainedBounds, tableBounds);
  const currentAnchor = settings.overlays.anchor || {};

  entry.manualMoveUntil = Date.now() + 600;
  entry.lastBounds = { ...currentBounds };
  entry.expectedBounds = { ...constrainedBounds };

  if (anchorsEqual(nextAnchor, currentAnchor)) {
    return;
  }

  settings.overlays.anchor = nextAnchor;
  settings.overlays.position = {
    ...(settings.overlays.position || {}),
    mode: "anchor"
  };
  delete settings.overlays.dragOffset;
  scheduleOverlayAnchorPersist();
  scheduleOverlayAnchorRefresh(id);
}

async function triggerRollForTable(tableId, reason, options = {}) {
  if (!["overlay-initial", "overlay-manual", "overlay-interval"].includes(reason)) return false;
  if (overlaysManuallyHidden) return false;
  const entry = overlays.get(tableId);
  if (!entry) return false;

  const now = Date.now();
  if (options.forceRepeat !== true && now - (entry.lastRollAt || 0) < 750) {
    return false;
  }
  
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

  try {
    const roll = createRngRoll(entry, randomInt);
    wc.send("roll-now", roll);
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

function createOverlayFor(win) {
  const id = win.id;
  if (overlays.has(id)) {
    destroyOverlayById(id, "replace-invalid-overlay");
  }
  logVerbose(`[CREATE START] Creating overlay for table ID=${id}`);
  const title = win.getTitle?.() || win.title || "";
  const tbl = getTableBounds(win);
  const r = lastOverlayPlacements.get(id) || overlayRectFor(tbl);

  const bw = new BrowserWindow({
    x: r.x, y: r.y, width: r.width, height: r.height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    alwaysOnTop: true,
    focusable: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    icon: iconPath,
    minimizable: false,
    maximizable: false,
    closable: false,
    thickFrame: false,              /* minimal window frame */
    titleBarStyle: 'hidden',        /* hide title bar completely */
    webPreferences: {
      preload: path.join(app.getAppPath(), "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  try { bw.setIgnoreMouseEvents(false); } catch {}
  try { bw.setAlwaysOnTop(true, "screen-saver"); } catch { bw.setAlwaysOnTop(true); }

  const overlayHandleKey = getBrowserWindowHandleKey(bw);

  bw.loadFile(path.join(app.getAppPath(), "index.html")).catch(err => console.error("overlay load:", err));
  bw.once("ready-to-show", () => {
    logVerbose(`[overlay] Main overlay ready for table ${id}`);
    let tableVisible = true;
    let tableMinimized = false;
    try {
      tableVisible = isPokerTableWindowEffectivelyVisible(win, { knownPokerClient: true });
      tableMinimized = win.isMinimized?.() || false;
    } catch {}
    const overlayEntry = overlays.get(id);
    if (overlayEntry?.isOccluded) {
      tableVisible = false;
    }
    const allowAutoShow =
      !overlaysManuallyHidden &&
      !tableMinimized &&
      tableVisible &&
      (!showOnlyActiveTables || win.id === currentFocusedTableId);
    if (allowAutoShow) {
      bw.showInactive();
      logVerbose(`[overlay] ✅ Showing overlay for ${title}`);
    } else if (overlaysManuallyHidden) {
      logVerbose(`[overlay] ⏸️ Keeping overlay hidden for ${title} (manually hidden)`);
    } else if (showOnlyActiveTables) {
      logVerbose(`[overlay] ⏸️ Hidden for ${title} (table not visible)`);
    }

    // Send table size for proportional font scaling
    try {
      bw.webContents.send("table-size", { width: tbl.width, height: tbl.height });
      bw.webContents.send(
        "set-auto-roll-interval",
        currentAutoRollInterval > 0 ? currentAutoRollInterval * 1000 : 0
      );
      logVerbose(`[DEBUG] Sent table size: ${tbl.width}x${tbl.height} to overlay`);

    } catch (e) {
      console.error("[DEBUG] Failed to send table size:", e.message);
    }
  });

  overlays.set(id, { 
    tableId: id,
    bw, 
    lastBounds: r, 
    lastTableBounds: { ...tbl },
    lastTitle: title, 
    lastRollAt: 0, 
    lastRngValue: null,
    pendingRoll: null,
    tableWin: win, // Store reference to native window for event tracking
    nativeIdKey: overlayHandleKey,
    isOccluded: lastOcclusionMap.get(id) === true,
    expectedBounds: { ...r },
    programmaticMoveUntil: Date.now() + PROGRAMMATIC_MOVE_SUPPRESS_MS,
    manualMoveUntil: 0
  });

  bw.on("move", () => handleRngOverlayMove(id, bw));
  bw.on("closed", () => {
    const entry = overlays.get(id);
    if (entry?.bw === bw) {
      destroyOverlayById(id, 'main-overlay-closed');
    }
  });
  
  logVerbose(`[🆕 OVERLAY CREATED] ID=${id}, title="${title}", manuallyHidden=${overlaysManuallyHidden}`);

  // Create buy-in display overlay in top-left
  if (settings.overlays.buyInEnabled !== false) {
    createStakesOverlay(win, tbl);
  }
  
  // Create clock overlay for every table
  if (settings.overlays.clockEnabled !== false) {
    createClockOverlay(win, tbl);
  }
}

function createStakesOverlay(win, tableBounds) {
  if (settings.overlays.buyInEnabled === false) return;
  const id = win.id;
  const title = win.getTitle?.() || win.title || "";
  const badge = stakeBadgeForTitle(title);
  if (!badge) return;
  const isRushCash = badge.rush;
  
  // Dynamic sizing based on table dimensions (like RNG overlay)
  const { fontSize,panelHeight:stakesPanelHeight, width: stakesWidth, height: stakesHeight, x: stakesX, y: stakesY } =
    auxiliaryOverlayLayout(tableBounds, isRushCash).stakes;
  
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
    titleBarStyle: 'hidden',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  try { stakesBw.setIgnoreMouseEvents(true); } catch {}
  try { stakesBw.setAlwaysOnTop(true, "screen-saver"); } catch { stakesBw.setAlwaysOnTop(true); }
  const stakesHandleKey = getBrowserWindowHandleKey(stakesBw);

  // Create simple HTML for stakes display
  const stakesHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Poker Stakes</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        ${overlayPanelCss}
        html, body {
          width: 100%;
          height: 100%;
          overflow: hidden;
          position: fixed;
          background: transparent;
        }
        body {
          color: ${badge.color};
          font-family: 'Segoe UI', Arial, sans-serif;
          font-size: ${fontSize}px;
          font-weight: bold;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .stakes-panel {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          height: ${stakesPanelHeight}px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #111820;
          border: 1px solid currentColor;
          border-radius: 4px;
          box-shadow: none;
        }
        .bi {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: clip;
          line-height: 1;
        }
      </style>
    </head>
    <body data-stake-level="${badge.level}">
      <div class="overlay-panel stakes-panel"><div class="bi">${badge.text}</div></div>
    </body>
    </html>
  `;

  stakesBw.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(stakesHTML)}`);
  
  stakesBw.once("ready-to-show", () => {
    // Force fixed size immediately
    stakesBw.setContentSize(stakesWidth, stakesHeight);
    stakesBw.setMinimumSize(stakesWidth, stakesHeight);
    stakesBw.setMaximumSize(stakesWidth, stakesHeight);
    logVerbose(`[overlay] Stakes overlay ready for table ${id}`);
    let tableVisible = true;
    let tableMinimized = false;
    try {
      tableVisible = isPokerTableWindowEffectivelyVisible(win, { knownPokerClient: true });
      tableMinimized = win.isMinimized?.() || false;
    } catch {}
    const overlayEntry = overlays.get(id);
    if (overlayEntry?.isOccluded) {
      tableVisible = false;
    }
    const allowAutoShow =
      !overlaysManuallyHidden &&
      !tableMinimized &&
      tableVisible &&
      (!showOnlyActiveTables || win.id === currentFocusedTableId);
    if (allowAutoShow) {
      stakesBw.showInactive();
      logVerbose(`[overlay] ✅ Showing stakes overlay`);
    } else if (overlaysManuallyHidden) {
      logVerbose(`[overlay] ⏸️ Stakes overlay hidden (manually hidden)`);
    } else if (showOnlyActiveTables) {
      logVerbose(`[overlay] ⏸️ Stakes overlay hidden (table not visible)`);
    }
  });

  // Store stakes overlay with the main overlay
  const entry = overlays.get(id);
  if (entry) {
    entry.stakesBw = stakesBw;
    entry.stakesBadgeValid = true;
    entry.stakesDisplayKey = JSON.stringify([badge.text, badge.color, fontSize]);
    entry.stakesLastBounds = { x: stakesX, y: stakesY, width: stakesWidth, height: stakesHeight };
    entry.stakesNativeIdKey = stakesHandleKey;
  }
}

function createClockOverlay(win, tableBounds) {
  if (settings.overlays.clockEnabled === false || settings.comfort.clockMode==='shared') return;
  try {
    const id = win.id;
    logVerbose(`[DEBUG] Creating clock overlay for table: ${id}`);
    
    // Dynamic sizing based on table dimensions
    const { width: clockWidth, height: clockHeight, x: clockX, y: clockY } = auxiliaryOverlayLayout(tableBounds).clock;
  
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
    titleBarStyle: 'hidden',
    webPreferences: {
      preload:path.join(app.getAppPath(),'src','clock-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  try { clockBw.setIgnoreMouseEvents(true); } catch {}
  try { clockBw.setAlwaysOnTop(true, "screen-saver"); } catch { clockBw.setAlwaysOnTop(true); }
  const clockHandleKey = getBrowserWindowHandleKey(clockBw);

  // Load clock HTML file
  clockBw.loadFile(path.join(app.getAppPath(), "clock.html")).catch(err => console.error("clock load:", err));
  
  clockBw.once("ready-to-show", () => {
    clockBw.setContentSize(clockWidth, clockHeight);
    clockBw.setMinimumSize(clockWidth, clockHeight);
    clockBw.setMaximumSize(clockWidth, clockHeight);
    logVerbose(`[overlay] Clock overlay ready for table ${id}`);
    let tableVisible = true;
    let tableMinimized = false;
    try {
      tableVisible = isPokerTableWindowEffectivelyVisible(win, { knownPokerClient: true });
      tableMinimized = win.isMinimized?.() || false;
    } catch {}
    const overlayEntry = overlays.get(id);
    if (overlayEntry?.isOccluded) {
      tableVisible = false;
    }
    const allowAutoShow =
      !overlaysManuallyHidden &&
      !tableMinimized &&
      tableVisible &&
      (!showOnlyActiveTables || win.id === currentFocusedTableId);
    if (allowAutoShow) {
      clockBw.showInactive();
      logVerbose(`[overlay] ✅ Showing clock overlay`);
    } else if (overlaysManuallyHidden) {
      logVerbose(`[overlay] ⏸️ Clock overlay hidden (manually hidden)`);
    } else if (showOnlyActiveTables) {
      logVerbose(`[overlay] ⏸️ Clock overlay hidden (table not visible)`);
    }
    
  });

  // Store clock overlay reference
  const entry = overlays.get(id);
  if (entry) {
    entry.clockBw = clockBw;
    entry.clockLastBounds = { x: clockX, y: clockY, width: clockWidth, height: clockHeight };
    entry.clockNativeIdKey = clockHandleKey;
  }
  } catch (err) {
    console.error(`[ERROR] Failed to create clock overlay for table ${win.id}:`, err);
  }
}

function writeFrameDiagnostics() {
  try {
    const frames = Array.from(overlays,([id,e]) => e.frameBw && !e.frameBw.isDestroyed() ?
      {tableId:id,visible:e.frameBw.isVisible(),bounds:e.frameBw.getBounds(),drawn:e.framePainted||null,stakes:e.stakesRendererMetrics||null} : null).filter(Boolean);
    fs.writeFileSync(path.join(app.getPath('userData'),'frame-status.json'),JSON.stringify({updatedAt:new Date().toISOString(),processId:process.pid,running:!appShuttingDown,
      session:{...comfortSession.status(settings.comfort),paused:!comfortSession.playing||!comfortSessionActive,focusWindows:focusWindows?.entries.length||0,focusError},workspace:workspacePlan,frames,stability:layoutStability.snapshot(),sessionFocusPanel:sessionFocusPanel?.status()||null},null,2));
  } catch(error) { logVerbose('[frame] Diagnostic update:',error.message); }
}

function queueFrameDiagnostics() {
  if (frameDiagnosticsTimer || appShuttingDown) return;
  frameDiagnosticsTimer = setTimeout(() => {
    frameDiagnosticsTimer = null;
    if (!appShuttingDown) writeFrameDiagnostics();
  },150);
  frameDiagnosticsTimer.unref();
}

function updateStakeFrame(entry, table) {
  if (settings.overlays.stakeFrameEnabled === false) {
    try { entry.frameBw?.destroy(); } catch {}
    entry.frameBw = null;
    entry.frameNativeIdKey = null;
    return;
  }
  const badge = stakeBadgeForTitle(entry.lastTitle);
  const activeAllowed = !showOnlyActiveTables || entry.tableId === currentFocusedTableId;
  if (!badge || overlaysManuallyHidden || !activeAllowed || !lastFrameBlockers.has(entry.tableId) ||
      !isPokerTableWindowEffectivelyVisible(entry.tableWin)) {
    try { entry.frameBw?.hide(); } catch {}
    return;
  }
  const { rects } = tableFrameLayout(table, lastFrameBlockers.get(entry.tableId),settings.appearance);
  if (!rects.length) { try { entry.frameBw?.hide(); } catch {} return; }
  if (!entry.frameBw || entry.frameBw.isDestroyed()) {
    const frame = new BrowserWindow({ ...table, frame:false, transparent:true,
      backgroundColor:'#00000000', resizable:false, alwaysOnTop:true, focusable:false,
      skipTaskbar:true, hasShadow:false, show:false, minimizable:false, maximizable:false,
      thickFrame:false, webPreferences:{ preload:path.join(app.getAppPath(),'src','table-frame-preload.cjs'),
        contextIsolation:true,nodeIntegration:false,backgroundThrottling:false } });
    entry.frameBw = frame;
    entry.frameReady = false;
    entry.frameStateKey = null;
    entry.frameNativeIdKey = getBrowserWindowHandleKey(frame);
    frame.on('show',queueFrameDiagnostics);
    frame.on('hide',queueFrameDiagnostics);
    frame.on('closed',queueFrameDiagnostics);
    frame.setIgnoreMouseEvents(true);
    frame.setAlwaysOnTop(true,'screen-saver');
    frame.webContents.on('did-start-loading', () => {
      entry.frameReady = false;
      entry.frameStateKey = null;
      entry.framePainted = null;
    });
    // First paint can precede external scripts; wait for the drawing listener
    // to be loaded before sending the first (otherwise cached) frame state.
    frame.webContents.on('did-finish-load', () => {
      if (overlays.get(entry.tableId) !== entry || frame.isDestroyed()) return;
      entry.frameReady = true;
      entry.frameStateKey = null;
      try { updateStakeFrame(entry,getTableBounds(entry.tableWin)); } catch { frame.hide(); }
    });
    frame.loadFile(path.join(app.getAppPath(),'src','table-frame.html')).catch(error => console.error('[frame] Load failed:',error.message));
  }
  if (!entry.frameReady) return;
  const frame = entry.frameBw;
  if (!boundsMatch(frame.getBounds(),table,0)) frame.setBounds(table,false);
  const payload = { color:badge.color,rects,opacity:settings.appearance.frameOpacity };
  const key = JSON.stringify(payload);
  if (!frame.isVisible() || entry.framePainted?.painted === false) entry.frameStateKey = null;
  if (entry.frameStateKey !== key) {
    entry.frameVersion = (entry.frameVersion || 0)+1;
    frame.webContents.send('stake-frame-state',{...payload,version:entry.frameVersion});
    entry.frameStateKey = key;
  }
  if (!frame.isVisible()) frame.showInactive();
  frame.moveTop();
}

function updateOverlayPosition(win, occlusionMap = lastOcclusionMap) {
  const entry = overlays.get(win.id);
  if (!entry) return;
  if (!isPokerTableWindowEffectivelyVisible(win)) { hideOverlayWindows(entry); return; }
  
  const tbl = getTableBounds(win);
  const r = lastOverlayPlacements.get(win.id) || overlayRectFor(tbl);
  entry.tableId = win.id;
  entry.tableWin = win;
  entry.lastTableBounds = { ...tbl };
  const currentTitle = win.getTitle?.() || win.title || entry.lastTitle || "";
  entry.lastTitle = currentTitle;
  entry.isOccluded = occlusionMap?.get(win.id) === true;
  updateStakeFrame(entry,tbl);

  if (overlaysManuallyHidden) {
    try { if (entry.bw?.isVisible?.()) entry.bw.hide(); } catch {}
    try { if (entry.stakesBw && entry.stakesBw.isVisible?.()) entry.stakesBw.hide(); } catch {}
    try { if (entry.clockBw && entry.clockBw.isVisible?.()) entry.clockBw.hide(); } catch {}
    entry.lastBounds = r;
    return;
  }

  if (
    settings.overlays.buyInEnabled !== false &&
    (!entry.stakesBw || entry.stakesBw.isDestroyed()) &&
    stakeBadgeForTitle(currentTitle)
  ) {
    createStakesOverlay(win, tbl);
  }
  if (
    settings.overlays.clockEnabled !== false &&
    (!entry.clockBw || entry.clockBw.isDestroyed())
  ) {
    createClockOverlay(win, tbl);
  }
  // Only update if position actually changed to avoid unnecessary operations
  const currentBounds = entry.bw.getBounds();
  const manualMoveActive = entry.manualMoveUntil > Date.now();
  const nextBounds = manualMoveActive
    ? { x: currentBounds.x, y: currentBounds.y, width: r.width, height: r.height }
    : r;
  if (!boundsMatch(currentBounds, nextBounds)) {
    entry.expectedBounds = { ...nextBounds };
    entry.programmaticMoveUntil = Date.now() + PROGRAMMATIC_MOVE_SUPPRESS_MS;
    entry.bw.setBounds(nextBounds, false);
  }
  
  // Update stakes overlay position and size if it exists
  if (entry.stakesBw && !entry.stakesBw.isDestroyed()) {
    const title = entry.lastTitle || "";
    const badge = stakeBadgeForTitle(title);
    entry.stakesBadgeValid = !!badge;
    if (badge) {
      const isRushCash = badge.rush;
      
      // Dynamic sizing based on table dimensions
      const { fontSize,panelHeight:stakesPanelHeight, width: stakesWidth, height: stakesHeight, x: stakesX, y: stakesY } = auxiliaryOverlayLayout(tbl, isRushCash).stakes;
      
      const currentStakesBounds = entry.stakesBw.getBounds();
      if (currentStakesBounds.x !== stakesX || currentStakesBounds.y !== stakesY ||
          currentStakesBounds.width !== stakesWidth || currentStakesBounds.height !== stakesHeight) {
        
        // Update size constraints
        entry.stakesBw.setMaximumSize(0, 0);
        entry.stakesBw.setMinimumSize(stakesWidth, stakesHeight);
        entry.stakesBw.setMaximumSize(stakesWidth, stakesHeight);
        entry.stakesBw.setBounds({ x: stakesX, y: stakesY, width: stakesWidth, height: stakesHeight }, false);
        
      }
      const displayKey = JSON.stringify([badge.text, badge.color, fontSize,stakesPanelHeight,stakesWidth]);
      const contents = entry.stakesBw.webContents;
      if (displayKey !== entry.stakesDisplayKey && !entry.stakesUpdatePending && !contents.isLoading()) {
        entry.stakesUpdatePending = true;
        const payload = JSON.stringify({ ...badge, fontSize,panelHeight:stakesPanelHeight });
        contents.executeJavaScript(`(() => {
          const badge = ${payload};
          document.querySelector('.bi').textContent = badge.text;
          document.body.style.color = badge.color;
          document.body.style.fontSize = badge.fontSize + 'px';
          document.body.dataset.stakeLevel = String(badge.level);
          const panel=document.querySelector('.stakes-panel');
          panel.style.height=badge.panelHeight+'px';
          const rect=panel.getBoundingClientRect();
          return {width:rect.width,height:rect.height,fontSize:parseFloat(getComputedStyle(document.body).fontSize),
            background:getComputedStyle(panel).backgroundColor,bodyBackground:getComputedStyle(document.body).backgroundColor,
            htmlBackground:getComputedStyle(document.documentElement).backgroundColor,hostHeight:innerHeight};
        })()`).then(metrics => { entry.stakesDisplayKey = displayKey;entry.stakesRendererMetrics=metrics;queueFrameDiagnostics(); })
          .catch(error => console.error('[stakes] Display update failed:', error.message))
          .finally(() => { entry.stakesUpdatePending = false; });
      }
    }
  }
  
  // Update clock overlay position and size if this table has a clock
  if (entry.clockBw && !entry.clockBw.isDestroyed()) {
    const clockLayout=auxiliaryOverlayLayout(tbl).clock;
    const {width:clockWidth,x:clockX,y:clockY}=clockLayout;
    const clockHeight=clockLayout.height+(entry.comfortDue?30:0);
    
    const currentClockBounds = entry.clockBw.getBounds();
    if (currentClockBounds.x !== clockX || currentClockBounds.y !== clockY ||
        currentClockBounds.width !== clockWidth || currentClockBounds.height !== clockHeight) {
      
      entry.clockBw.setMaximumSize(0, 0);
      entry.clockBw.setMinimumSize(clockWidth, clockHeight);
      entry.clockBw.setMaximumSize(clockWidth, clockHeight);
      entry.clockBw.setBounds({ x: clockX, y: clockY, width: clockWidth, height: clockHeight }, false);
      
      
    }
  }
  
  // Sync visibility with table visibility (like overlay is attached to table)
  try {
    let isTableVisible = true;
    let isMinimized = false;
    
    try {
      isTableVisible = isPokerTableWindowEffectivelyVisible(win, { knownPokerClient: true });
      isMinimized = win.isMinimized?.() || false;
    } catch (e) {
      destroyOverlayById(win.id, "window-closed");
      return;
    }
    if (entry.isOccluded) {
      isTableVisible = false;
    }
    
    const overlayVisible = entry.bw.isVisible();
    const isOverlayReady = !entry.bw.isDestroyed() && entry.bw.webContents && !entry.bw.webContents.isLoading();
    const passesActiveFilter =
      !showOnlyActiveTables ||
      win.id === currentFocusedTableId;
    const shouldShowOverlay =
      isTableVisible &&
      !isMinimized &&
      !overlaysManuallyHidden &&
      passesActiveFilter;
    const shouldHideOverlay =
      !isTableVisible ||
      isMinimized ||
      overlaysManuallyHidden ||
      !passesActiveFilter;
    
    logVerbose(`[SCANNER] ${entry.lastTitle}:`);
    logVerbose(`  - isTableVisible: ${isTableVisible}, isMinimized: ${isMinimized}`);
    logVerbose(`  - isOccluded: ${entry.isOccluded}`);
    logVerbose(`  - overlaysManuallyHidden: ${overlaysManuallyHidden}`);
    logVerbose(`  - passesActiveFilter: ${passesActiveFilter}`);
    logVerbose(`  - shouldShowOverlay: ${shouldShowOverlay}`);
    
    try {
      if (shouldShowOverlay && isOverlayReady) {
        if (!overlayVisible) {
          logVerbose(`[SCANNER] ✅ SHOWING overlay for ${entry.lastTitle}`);
          entry.bw.showInactive();
        }
        try { entry.bw.setAlwaysOnTop(true, "screen-saver"); } catch { try { entry.bw.setAlwaysOnTop(true); } catch {} }
        try { entry.bw.moveTop(); } catch {}
        if (entry.stakesBw && !entry.stakesBw.isDestroyed()) {
          if (!entry.stakesBadgeValid) {
            entry.stakesBw.hide();
          } else {
            if (entry.stakesBw.isVisible?.() === false) entry.stakesBw.showInactive();
            // Electron's moveTop() also shows a hidden window on Windows.
            try { entry.stakesBw.moveTop(); } catch {}
          }
        }
        if (entry.clockBw && !entry.clockBw.isDestroyed()) {
          if (entry.clockBw.isVisible?.() === false) {
            entry.clockBw.showInactive();
          }
          try { entry.clockBw.moveTop(); } catch {}
        }
      } else if (shouldHideOverlay) {
        logVerbose(`[SCANNER] ❌ HIDING overlay for ${entry.lastTitle}`);
        if (overlayVisible) entry.bw.hide();
        if (entry.stakesBw && !entry.stakesBw.isDestroyed()) {
          entry.stakesBw.hide();
        }
        if (entry.clockBw && !entry.clockBw.isDestroyed()) {
          entry.clockBw.hide();
        }
      }
    } catch (e) {
      console.error(`[SCANNER] Failed to sync visibility:`, e.message);
    }
  } catch (e) {
    console.error(`[SCANNER] Visibility sync failed:`, e.message);
  }
  
  // Send updated table size for proportional font scaling
  try { 
    entry.bw.webContents.send("table-size", { width: tbl.width, height: tbl.height }); 
    logVerbose(`[DEBUG] Updated table size: ${tbl.width}x${tbl.height} to overlay`);
  } catch (e) {
    console.error(`[DEBUG] Failed to update table size:`, e.message);
  }
  entry.lastBounds = manualMoveActive ? entry.bw.getBounds() : r;
}

function refreshAllOverlayPositions(reason = "manual-refresh") {
  const windows = windowManager.getWindows();
  const occlusionMap = computeOcclusionMap(windows);
  lastOcclusionMap = occlusionMap;
  for (const [id, entry] of overlays) {
    const win = entry.tableWin;
    if (!win) continue;
    try {
      updateOverlayPosition(win, occlusionMap);
    } catch (err) {
      console.error(`[overlay] Failed to refresh overlay ${id} (${reason}):`, err.message);
    }
  }
}

function clockStatusFor(sender) {
  const status={...comfortSession.status(settings.comfort),paused:!comfortSession.playing||!comfortSessionActive,focusError,controlsEnabled:!liveTest,layoutEnabled:!liveTest&&settings.tableLayout?.enabled===true};
  if(senderMatchesWindow(sender,sharedClockWindow)) return status;
  for(const entry of overlays.values()) if(senderMatchesWindow(sender,entry.clockBw)) {
    const selected=entry.comfortDue===true;
    return {...status,breakDue:selected&&status.breakDue,breakActive:selected&&status.breakActive,breakReady:selected&&status.breakReady,
      breakRemainingSeconds:selected?status.breakRemainingSeconds:0};
  }
  return null;
}

function initializeFocusWindows() {
  if(focusWindows)return;
  const save=entries=>{
    ensureUserSettingsDir();
    const temporary=focusJournalPath+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify({version:1,entries},null,2),'utf8');
    fs.renameSync(temporary,focusJournalPath);
  };
  focusWindows=new FocusWindows({adapter:createWindowsFocusAdapter(windowManager),cookie:randomInt(1,0x7fffffff),save,
    isProtected:win=>{
      const own=collectOverlayHandleKeys();
      for(const extra of [settingsWindow,intervalSelectorWindow]){const key=getBrowserWindowHandleKey(extra);if(key)own.add(key);}
      return own.has(String(win.id))||isKnownPokerClientWindow(win)||
        path.win32.normalize(String(win.path||'')).toLowerCase()===path.win32.normalize(process.execPath).toLowerCase();
    }});
  const saved=readSettingsFile(focusJournalPath,'focus recovery');
  if(Array.isArray(saved?.entries)&&saved.entries.length) {
    focusWindows.restore(saved.entries.filter(e=>Number.isSafeInteger(e?.id)&&Number.isSafeInteger(e.pid)&&Number.isSafeInteger(e.cookie)&&typeof e.path==='string'));
    if(focusWindows.entries.length)focusError='Some windows still need restoring';
  }
}

function restoreFocusWindows() {
  if(!focusWindows)return;
  try{focusWindows.restore();focusError=focusWindows.entries.length?'Some windows still need restoring':'';}
  catch(error){focusError='Could not restore all windows';console.error('[focus] Restore failed:',error.message);}
}

function setPlayingState(playing) {
  if(liveTest)return;
  const next=playing===true;
  if(next===comfortSession.playing)return;
  syncComfortWindows();
  focusError='';
  if(next) {
    const hasOpenTable=[...overlays.values()].some(e=>{try{return isPokerTableWindowEffectivelyVisible(e.tableWin);}catch{return false;}});
    // A covering app is precisely what focus mode is meant to minimize.
    // Requiring an uncovered table here would make tray Start unusable.
    if(!hasOpenTable){focusError='Open a table before starting';broadcastSettings();return;}
    try{initializeFocusWindows();focusWindows.enter();}
    catch(error){restoreFocusWindows();focusError='Could not minimize all windows';console.error('[focus] Start failed:',error.message);}
  } else restoreFocusWindows();
  comfortSession.setPlaying(next);
  syncComfortWindows();broadcastSettings();queueFrameDiagnostics();
}

function destroySharedClock() {
  clearTimeout(sharedClockMoveTimer);sharedClockMoveTimer=null;
  const previous=sharedClockWindow;sharedClockWindow=null;sharedClockReady=false;
  try {if(previous&&!previous.isDestroyed())previous.destroy();}catch{}
}

function createSharedClock(entries) {
  const saved=settings.comfort.clockPosition;
  const display=saved?screen.getDisplayNearestPoint(saved):screen.getDisplayMatching(entries[0].lastTableBounds);
  const clockPhysical=sessionFocusContext?.clockRect||workspacePlan?.slots.clock;
  const workspaceBounds=clockPhysical?screen.screenToDipRect(null,clockPhysical):null;
  const bounds=workspaceBounds||(saved?sharedClockRect(display.workArea,saved):defaultClockPosition(display.workArea,entries.map(e=>e.lastTableBounds)));
  sharedClockProgrammaticBounds=bounds;workspaceClockManual=false;
  const bw=new BrowserWindow({...bounds,frame:false,transparent:true,backgroundColor:'#00000000',
    resizable:false,alwaysOnTop:true,focusable:true,skipTaskbar:true,hasShadow:false,show:false,
    minimizable:false,maximizable:false,thickFrame:false,
    webPreferences:{preload:path.join(app.getAppPath(),'src','clock-preload.cjs'),contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  sharedClockWindow=bw;sharedClockReady=false;
  if(workspacePlan?.layout==='automatic-count-grid')bw.webContents.setZoomFactor(Math.min((clockPhysical?.width||324)/324,(clockPhysical?.height||192)/192)/(workspacePlan.scaleFactor||1));
  bw.setAlwaysOnTop(true,'screen-saver');
  bw.webContents.on('did-finish-load',()=>{
    if(sharedClockWindow!==bw||bw.isDestroyed())return;
    sharedClockReady=true;syncComfortWindows();
  });
  bw.on('move',()=>{
    if(!sharedClockReady||bw.isDestroyed())return;
    if(sharedClockProgrammaticBounds&&boundsMatch(bw.getBounds(),sharedClockProgrammaticBounds,1))return;
    workspaceClockManual=true;
    clearTimeout(sharedClockMoveTimer);
    const finishMove=()=>{
      if(bw.isDestroyed()||sharedClockWindow!==bw)return;
      if(workspacePlan?.slots.clock){
        if(workspaceAdapter.isDragging()){sharedClockMoveTimer=setTimeout(finishMove,100);return;}
        workspaceClockManual=false;syncComfortWindows();return;
      }
      const current=bw.getBounds(), work=screen.getDisplayMatching(current).workArea;
      const clamped=sharedClockRect(work,current,current.height);
      if(!boundsMatch(current,clamped,0))bw.setBounds(clamped,false);
      settings.comfort.clockPosition={x:clamped.x,y:clamped.y};
      persistSettingsSnapshot(settings,'shared clock position');
    };
    sharedClockMoveTimer=setTimeout(finishMove,300);
  });
  bw.on('closed',()=>{if(sharedClockWindow===bw){sharedClockWindow=null;sharedClockReady=false;}});
  bw.loadFile(path.join(app.getAppPath(),'clock.html'),{query:{shared:'1',workspace:workspaceBounds?'1':'0'}}).catch(error=>console.error('[clock] Load failed:',error.message));
}

function syncComfortWindows() {
  if(appShuttingDown)return;
  comfortSession.tick(Date.now(),comfortSessionActive);
  if(comfortSession.playing && ![...overlays.values()].some(e=>{try{return e.tableWin?.isWindow?.()!==false;}catch{return false;}})) {
    comfortSession.setPlaying(false);restoreFocusWindows();broadcastSettings();queueFrameDiagnostics();
  }
  // Session activity follows table visibility, independently of hiding overlays.
  const visible=[...overlays.values()].filter(e=>{
    try{return e.tableWin && isPokerTableWindowEffectivelyVisible(e.tableWin) && lastFrameBlockers.has(e.tableId) &&
      tableFrameLayout(getTableBounds(e.tableWin),lastFrameBlockers.get(e.tableId)).rects.length>0;}catch{return false;}
  });
  comfortSessionActive=visible.length>0;
  const eligible=visible.filter(e=>!showOnlyActiveTables||e.tableId===currentFocusedTableId);
  const show=eligible.length>0&&!overlaysManuallyHidden&&settings.overlays.clockEnabled!==false&&sessionFocusContext?.clockUnavailable!==true;
  const shared=settings.comfort.clockMode==='shared';
  if(!shared || settings.overlays.clockEnabled===false) destroySharedClock();
  if(shared&&show&&(!sharedClockWindow||sharedClockWindow.isDestroyed()))createSharedClock(eligible);
  if(sharedClockWindow&&!sharedClockWindow.isDestroyed()) {
    if(show&&sharedClockReady) {
      const current=sharedClockWindow.getBounds(),work=screen.getDisplayMatching(current).workArea;
      const breakState=comfortSession.status(settings.comfort);
      const extra=(breakState.breakDue||breakState.breakActive||breakState.breakReady?26:0)+(focusError?18:0);
      const clockPhysical=sessionFocusContext?.clockRect||workspacePlan?.slots.clock;
      const workspaceBounds=clockPhysical?screen.screenToDipRect(null,clockPhysical):null;
      const clockZoom=workspacePlan?.layout==='automatic-count-grid'?Math.min((clockPhysical?.width||324)/324,(clockPhysical?.height||192)/192)/(workspacePlan.scaleFactor||1):1;
      if(Math.abs(sharedClockWindow.webContents.getZoomFactor()-clockZoom)>.001)sharedClockWindow.webContents.setZoomFactor(clockZoom);
      const clamped=workspaceBounds?(workspaceClockManual?current:workspaceBounds):sharedClockRect(work,current,148+extra);
      if(!boundsMatch(current,clamped,0)){sharedClockProgrammaticBounds=clamped;sharedClockWindow.setBounds(clamped,false);}
      if(!sharedClockWindow.isVisible())sharedClockWindow.showInactive();
      const status=clockStatusFor(sharedClockWindow.webContents),key=JSON.stringify(status);
      if(sharedClockWindow.comfortStatusKey!==key){sharedClockWindow.webContents.send('clock:status',status);sharedClockWindow.comfortStatusKey=key;}
    } else sharedClockWindow.hide();
  }
  const breakStatus=comfortSession.status(settings.comfort);
  const notice=breakStatus.breakDue||breakStatus.breakActive||breakStatus.breakReady;
  const cueEntry=!shared&&show&&notice?eligible.find(e=>e.clockBw?.isVisible()):null;
  for(const entry of overlays.values()) {
    const nextDue=entry===cueEntry;
    if(entry.comfortDue!==nextDue){entry.comfortDue=nextDue;if(entry.tableWin)updateOverlayPosition(entry.tableWin);}
    if(entry.clockBw&&!entry.clockBw.isDestroyed()) {
      const status=clockStatusFor(entry.clockBw.webContents),key=JSON.stringify(status);
      if(entry.clockStatusKey!==key){entry.clockBw.webContents.send('clock:status',status);entry.clockStatusKey=key;}
    }
  }
  const phase=breakStatus.breakActive?'active':breakStatus.breakReady?'ready':breakStatus.breakDue?'due':'idle';
  if(phase!==lastComfortBreakPhase){lastComfortBreakPhase=phase;broadcastSettings();queueFrameDiagnostics();}
  syncSessionFocusPanel(visible.length>0&&!overlaysManuallyHidden);
}

function applyBreakAction(action) {
  if(liveTest)return;
  if(action==='start-break'){setPlayingState(false);comfortSession.startBreak();}
  else if(action==='snooze')comfortSession.snooze();
  else if(action==='complete')comfortSession.completeBreak();
  syncComfortWindows();
  queueFrameDiagnostics();
}

function destroyOverlayById(id, reason = "cleanup") {
  const entry = overlays.get(id);
  if (!entry) return;

  overlays.delete(id);
  overlayMisses.delete(id);
  overlayTableMisses.delete(id);

  const windowsToClose = [entry.bw, entry.stakesBw, entry.clockBw, entry.frameBw];
  if (entry.frameBw) queueFrameDiagnostics();
  for (const win of windowsToClose) {
    if (!win) continue;
    try { if (win.isVisible?.()) win.hide(); } catch {}
    try { win.removeAllListeners?.(); } catch {}
    try { win.close(); } catch {}
    try { win.destroy(); } catch {}
  }

  if (!quietMode) {
    console.log(`[scan] Destroyed overlay ${id}${reason ? ` (${reason})` : ""}`);
  }
}

function cleanupMissing(nativeWindowIds) {
  for (const [id, entry] of overlays) {
    if (nativeWindowIds.has(id)) {
      overlayMisses.delete(id);
      continue;
    }

    hideOverlayWindows(entry);

    const misses = (overlayMisses.get(id) || 0) + 1;
    overlayMisses.set(id, misses);
    if (misses >= OVERLAY_DESTROY_MISS_THRESHOLD) {
      destroyOverlayById(id, "window-missing");
      overlayMisses.delete(id);
    }
  }
}

function updatePokerWorkspace(tables,nativeWindows=[],mixedPresence=false) {
  let next=null;
  let layoutWindows=tables;
  const profile=getActiveLayoutProfile(tableLayoutManager.effectiveConfig(settings.tableLayout));
  if(settings.workspace.enabled&&settings.tableLayout.enabled&&settings.tableLayout.autoArrange&&
    profile.monitorId==='primary'&&(tables.length||pokerWorkspace.active)) {
    const monitor=tableLayoutManager.getMonitorDescriptors().find(m=>m.primary);
    if(monitor){
      const prepared=preparePokerLayoutScan({tables,nativeWindows,session:pokerWorkspace,
        adapter:workspaceAdapter,monitor,profile,mixedPresence});
      next=prepared.plan;layoutWindows=prepared.layoutWindows;
    }
  }else pokerWorkspace.reset();
  const key=JSON.stringify(next);
  if(key!==workspacePlanKey){
    const styleChanged=!!workspacePlan?.slots.clock!==!!next?.slots.clock;
    workspacePlan=next;workspacePlanKey=key;
    if(styleChanged)destroySharedClock();
    broadcastSettings();queueFrameDiagnostics();
  }
  return layoutWindows;
}

function updateSessionFocusContext(windows,tables){
  if(liveTest||workspacePlan?.mode!=='full'||!settings.workspace.enabled){sessionFocusContext=null;sessionFocusPlacementKey='';return;}
  try{
    const work=workspacePlan.workArea||tableLayoutManager.getMonitorDescriptors().find(m=>m.primary)?.workArea;
    const actual=[],tableKeys=new Set(tables.map(w=>`${w.processId}:${w.id}`));
    for(const entry of overlays.values())if(entry.tableWin)tableKeys.add(`${entry.tableWin.processId}:${entry.tableWin.id}`);
    for(const owner of pokerWorkspace.reservations)tableKeys.add(`${owner.pid}:${owner.id}`);
    for(const win of windows){
      if(!tableKeys.has(`${win.processId}:${win.id}`)&&!isGgProcess(win))continue;
      if(!workspaceAdapter.visible(win))continue;
      let known=tableKeys.has(`${win.processId}:${win.id}`);
      if(!known&&isGgProcess(win)){
        const binding=workspaceManager.bindings.get(win.id);
        known=binding?.pid===win.processId||!!classifyPokerUtility(win,workspaceAdapter.inspect(win));
      }
      if(known)actual.push(workspaceAdapter.bounds(win));
    }
    let fixedClock=null;
    if(workspaceClockManual&&sharedClockWindow&&!sharedClockWindow.isDestroyed()&&sharedClockWindow.isVisible()){
      fixedClock=screen.dipToScreenRect(sharedClockWindow,sharedClockWindow.getBounds());actual.push(fixedClock);
    }
    const context={tables:workspacePlan.tableRects,slots:workspacePlan.slots,actual,scaleFactor:workspacePlan.scaleFactor||1,preferred:workspacePlan.ownedPanels};
    const focusEnabled=normalizeSessionFocus(settings.sessionFocus).enabled;
    const clockEnabled=settings.overlays.clockEnabled!==false&&settings.comfort.clockMode==='shared';
    const key=JSON.stringify([work,context,fixedClock,focusEnabled,clockEnabled]);
    if(key!==sessionFocusPlacementKey){
      const adaptive=workspacePlan.layout==='automatic-count-grid'?ownedPanelLayout(work,{...context,fixedClock,focusEnabled,clockEnabled}):null;
      const physical=adaptive?adaptive.focus:sessionFocusRect(work,context);
      sessionFocusContext={rect:physical?screen.screenToDipRect(null,physical):null,clockRect:adaptive?.clock||null,clockUnavailable:!!adaptive&&clockEnabled&&!adaptive.clock,zoom:adaptive?1/(workspacePlan.scaleFactor||1):1};sessionFocusPlacementKey=key;
    }
  }catch{sessionFocusContext=null;sessionFocusPlacementKey='';}
}

function syncSessionFocusPanel(visible){
  if(liveTest||!scanTimer){sessionFocusPanel?.sync({show:false,rect:null});return;}
  const model=normalizeSessionFocus(settings.sessionFocus),show=visible&&model.enabled&&!!sessionFocusContext?.rect;
  if(!sessionFocusPanel&&show)sessionFocusPanel=new SessionFocusPanel({BrowserWindow,root:app.getAppPath(),
    getState:()=>normalizeSessionFocus(settings.sessionFocus),onHide:()=>updateSessionFocus({enabled:false})});
  sessionFocusPanel?.sync({show,rect:sessionFocusContext?.rect||null,zoom:sessionFocusContext?.zoom||1});
}

function updateSessionFocus(patch){
  if(liveTest)throw new Error('Session focus editing is disabled in this layout test');
  ensureUserSettingsDir();
  const next=saveSessionFocusPatch(settings,userSettingsPath,patch);
  settings.sessionFocus=next.sessionFocus;
  sessionFocusPanel?.publish();broadcastSettings();syncComfortWindows();queueFrameDiagnostics();
  return normalizeSessionFocus(settings.sessionFocus);
}

function updateSessionFocusFromNative(patch){
  try{return updateSessionFocus(patch);}catch{
    sessionFocusPanel?.reportFailure(patch);
    try{tray?.setToolTip('Could not save session focus. Retry in Settings.');}catch{}
    return null;
  }
}

function observeLayoutStability(windows,tables) {
  // Observe only known table/utility identities using the scan's existing window list.
  // A missing enumeration is never interpreted here as destruction.
  try {
    const tracked=new Map(layoutStability.identities().map(r=>[`${r.pid}:${r.id}`,r]));
    for(const win of tables)tracked.set(`${win.processId}:${win.id}`,{id:win.id,pid:win.processId,role:'table'});
    for(const r of pokerWorkspace.reservations)tracked.set(`${r.pid}:${r.id}`,{id:r.id,pid:r.pid,role:'table'});
    for(const [id,binding]of workspaceManager.bindings){
      const win=windows.find(w=>w.id===id&&w.processId===binding.pid);if(!win)continue;
      tracked.set(`${win.processId}:${id}`,{id,pid:win.processId,role:binding.slotKey.replace(/[2-9]$/,'')});
    }
    const byIdentity=new Map(windows.map(w=>[`${w.processId}:${w.id}`,w])),records=[];
    for(const [identity,r]of tracked){
      const win=byIdentity.get(identity);if(!win)continue;
      const record={...r,present:true};
      try{record.bounds=workspaceAdapter.bounds(win);}catch{}
      try{record.visible=workspaceAdapter.visible(win)===true;}catch{}
      try{const minimized=workspaceAdapter.minimized?.(win);if(typeof minimized==='boolean')record.minimized=minimized;}catch{}
      const entry=overlays.get(r.id);
      if(r.role==='table'&&entry?.tableWin?.processId===r.pid)record.overlays=Object.fromEntries(
        [['rng','bw'],['stakes','stakesBw'],['clock','clockBw'],['frame','frameBw']].map(([role,field])=>{
          try{return [role,!!entry[field]&&!entry[field].isDestroyed()&&entry[field].isVisible()];}catch{return [role,false];}
        }));
      records.push(record);
    }
    if(layoutStability.observe(records,workspacePlan))queueFrameDiagnostics();
  }catch(error){logVerbose('[layout] Diagnostic observation failed:',error.message);}
}

async function scanTables() {
  if (appShuttingDown) return;
  const allWindows = windowManager.getWindows();
  const overlayHandleKeys = collectOverlayHandleKeys();
  const nativeWindows = allWindows.filter((w) => !overlayHandleKeys.has(String(w.id)));
  if(liveTest&&!liveTest.preflight(nativeWindows))return;
  const windowById = new Map(nativeWindows.map(w => [w.id, w]));
  
  // Filter poker windows
  const matchedWindows = nativeWindows.filter((w) => {
    try {
      return isPokerWindow(w);
    } catch {
      return false;
    }
  });
  const { windows: wins, duplicateIds, canonicalIdById } = liveTest?
    {windows:nativeWindows.filter(liveTest.isTarget),duplicateIds:new Set(),canonicalIdById:new Map()}:
    dedupeTableWindows(
    matchedWindows,
    new Set(overlays.keys())
  );
  const occlusionMap = computeOcclusionMap(allWindows, canonicalIdById);
  lastOcclusionMap = occlusionMap;
  for (const duplicateId of duplicateIds) {
    if (overlays.has(duplicateId)) {
      destroyOverlayById(duplicateId, "duplicate-table-window");
    }
  }
  
  const ids = new Set(wins.map(w => w.id));
  const nativeWindowIds = new Set([
    ...nativeWindows.map(w => w.id),
    ...duplicateIds
  ]);

  if (!appShuttingDown) {
    const layoutWindows = updatePokerWorkspace(wins.filter((win) => !isCoinPokerContainerWindow(win)),nativeWindows,wins.some(isCoinPokerContainerWindow));
    if(!liveTest||liveTest.beginPlacement(workspacePlan,pokerWorkspace.reservations,nativeWindows)){
      tableLayoutManager.maybeArrange(layoutWindows, settings.tableLayout);
      if(layoutWindows.length)workspaceManager.sync(liveTest?liveTest.placementWindows(nativeWindows):nativeWindows,workspacePlan);
      liveTest?.endPlacement(nativeWindows);
    }
  }
  
  let activeTableId = null;
  if (typeof windowManager.getActiveWindow === "function") {
    try {
      const activeWin = windowManager.getActiveWindow();
      const canonicalActiveId = activeWin
        ? (canonicalIdById.get(activeWin.id) ?? activeWin.id)
        : null;
      if (canonicalActiveId != null && ids.has(canonicalActiveId)) {
        activeTableId = canonicalActiveId;
      }
    } catch (e) {
      if (!quietMode) console.error("[scan] Failed to determine active window:", e.message);
    }
  }
  currentFocusedTableId = activeTableId;
  
  for (const w of wins) {
    if (!overlays.has(w.id)) {
      adoptOverlayForWindow(w);
    }
    overlayMisses.delete(w.id);
    overlayTableMisses.delete(w.id);
    logVerbose(`[🔍 SCANNER CHECK] Table ID=${w.id}, hasOverlay=${overlays.has(w.id)}, title="${w.getTitle?.() || w.title}"`);
    if (overlays.has(w.id)) {
      const existingEntry = overlays.get(w.id);
      if (!existingEntry?.bw || existingEntry.bw.isDestroyed?.()) {
        destroyOverlayById(w.id, "main-overlay-destroyed");
        createOverlayFor(w);
        continue;
      }
      // Ensure window is still accessible before updating position
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

      updateOverlayPosition(w, occlusionMap);
    } else {
      logVerbose(`[🔍 SCANNER] Table ${w.id} "${w.getTitle?.() || w.title}" NOT in overlays map - will create`);
      logVerbose(`[scan] ? Found poker table: "${w.getTitle?.() || w.title || w.id}"`);
      createOverlayFor(w);
      // Call updateOverlayPosition on next tick to allow ready-to-show to complete
      const occlusionSnapshot = occlusionMap;
      setImmediate(() => {
        if (overlays.has(w.id)) {
          updateOverlayPosition(w, occlusionSnapshot);
        }
      });
    }
  }
  
  // Keep overlays through transient title/class/minimized detection misses
  // while the same native table window still exists.
  for (const [id, entry] of Array.from(overlays)) {
    if (ids.has(id)) {
      overlayTableMisses.delete(id);
      continue;
    }
    const nativeWin = windowById.get(id);
    if (!nativeWin) continue;

    if (isBrowserWindow(nativeWin)) {
      destroyOverlayById(id, "browser-window");
      continue;
    }

    if (!entry?.bw || entry.bw.isDestroyed?.()) {
      destroyOverlayById(id, "main-overlay-destroyed");
      continue;
    }

    let isMinimized = false;
    let isVisible = true;
    try {
      isMinimized = nativeWin.isMinimized?.() || false;
    } catch {}
    try {
      if (!isPokerTableWindowEffectivelyVisible(nativeWin, { knownPokerClient: true })) {
        isVisible = false;
      }
    } catch {}
    const retention = updateUnmatchedTableMisses(overlayTableMisses.get(id) || 0, {
      threshold: OVERLAY_TABLE_MISS_THRESHOLD,
      minimized: isMinimized,
      visible: isVisible
    });
    if (retention.destroy) {
      destroyOverlayById(id, "table-no-longer-matched");
      continue;
    }
    if (retention.nextMisses > 0) {
      overlayTableMisses.set(id, retention.nextMisses);
    } else {
      overlayTableMisses.delete(id);
    }

    try {
      updateOverlayPosition(nativeWin, occlusionMap);
    } catch (err) {
      logVerbose(`[overlay] Retaining table ${id} through transient scan miss: ${err.message}`);
    }
  }

  lastActiveTableId = activeTableId;
  
  cleanupMissing(nativeWindowIds);
  tableLayoutManager.cleanup(nativeWindowIds,pokerWorkspace.reservations);
  updateSessionFocusContext(nativeWindows,wins);
  syncComfortWindows();
  observeLayoutStability(nativeWindows,wins);
  
  // Log status only when it changes
  if (!quietMode && (wins.length > 0 || overlays.size > 0)) {
    console.log(`[scan] Tables: ${wins.length}, Overlays: ${overlays.size}, Active: ${activeTableId ?? 'none'}`);
  }
}

async function runScannerTick() {
  if (scanRunning) return;
  scanRunning = true;
  try {
    await scanTables();
  } catch (e) {
    console.error("[scan] Tick failed:", e.message || e);
    liveTest?.fail(e);
  } finally {
    scanRunning = false;
    if (scanRerunRequested) {
      scanRerunRequested = false;
      void runScannerTick();
    }
  }
}

function requestTableLayoutApply() {
  if(liveTest)return;
  if (settings.tableLayout?.enabled !== true) return;
  pokerWorkspace.reset();
  tableLayoutManager.requestApply();
  if (scanRunning) {
    scanRerunRequested = true;
    return;
  }
  void runScannerTick();
}

function startScanner() {
  if (scanTimer) clearInterval(scanTimer);
  const intervalMs = Math.max(120, Number(settings.scanMs) || 300);

  void runScannerTick();
  scanTimer = setInterval(() => { void runScannerTick(); }, intervalMs);
}
function stopScanner()  { if (scanTimer) { clearInterval(scanTimer); scanTimer = null; } scanRerunRequested = false;sessionFocusContext=null;sessionFocusPlacementKey='';sessionFocusPanel?.sync({show:false,rect:null}); }

function startSessionTimer() { 
  if (sessionTimer) clearInterval(sessionTimer); 
  sessionTimer = setInterval(() => {
    syncComfortWindows();
    
    if (tray) {
      try {
        tray.setContextMenu(buildMenu());
      } catch (e) {
        console.error("Failed to update session time in tray:", e.message);
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
  comfortSession.reset();
  syncComfortWindows();broadcastSettings();queueFrameDiagnostics();
  console.log("[timer] Session timer reset to 00:00:00");
}

const AUTO_START_REGISTRY_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const AUTO_START_REGISTRY_VALUE = "PokerRNG";

function resolveAutoStartExecutablePath() {
  const candidates = [
    process.env.PORTABLE_EXECUTABLE_FILE,
    settings?.autoStartExecutablePath,
    !app.isPackaged
      ? path.join(app.getAppPath(), "dist", `PokerRNG-${app.getVersion()}-portable.exe`)
      : null,
    process.execPath
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) return resolved;
  }
  return path.resolve(process.execPath);
}

function readWindowsAutoStartCommand() {
  try {
    const output = execFileSync(
      "reg.exe",
      ["QUERY", AUTO_START_REGISTRY_KEY, "/v", AUTO_START_REGISTRY_VALUE],
      { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
    );
    const match = output.match(/\bREG_SZ\s+(.+)\s*$/im);
    return match?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

function setAutoStart(enabled) {
  if(isolatedRun)return;
  if (process.platform !== "win32") {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, args: [] });
    return;
  }

  if (!enabled) {
    try {
      execFileSync(
        "reg.exe",
        ["DELETE", AUTO_START_REGISTRY_KEY, "/v", AUTO_START_REGISTRY_VALUE, "/f"],
        { windowsHide: true, stdio: "ignore" }
      );
    } catch {}
    return;
  }

  const executablePath = resolveAutoStartExecutablePath();
  const command = `"${executablePath}" --startup`;
  execFileSync(
    "reg.exe",
    [
      "ADD",
      AUTO_START_REGISTRY_KEY,
      "/v",
      AUTO_START_REGISTRY_VALUE,
      "/t",
      "REG_SZ",
      "/d",
      command,
      "/f"
    ],
    { windowsHide: true, stdio: "ignore" }
  );
  if (settings.autoStartExecutablePath !== executablePath) {
    settings.autoStartExecutablePath = executablePath;
    persistSettingsSnapshot(settings, "Start with Windows executable path");
  }
  logVerbose(`[settings] Start with Windows points to ${executablePath}`);
}

function isAutoStartEnabled() {
  if(isolatedRun)return false;
  if (process.platform !== "win32") {
    return !!app.getLoginItemSettings().openAtLogin;
  }
  const command = readWindowsAutoStartCommand();
  if (!command) return false;
  const executableMatch = command.match(/^"([^"]+)"/) || command.match(/^(\S+)/);
  const executablePath = executableMatch?.[1] || "";
  return !!executablePath && fs.existsSync(executablePath);
}

function setAutoRollInterval(seconds) {
  currentAutoRollInterval = timerSeconds(seconds);
  
  // Update settings
  settings.autoRollMs = currentAutoRollInterval > 0 ? currentAutoRollInterval * 1000 : 0;
  persistSettingsSnapshot(settings, "auto-roll interval");
  
  // Broadcast new interval to all overlays
  const payloadMs = currentAutoRollInterval > 0 ? currentAutoRollInterval * 1000 : 0;
  for (const [id, { bw }] of overlays) {
    try {
      bw.webContents.send("set-auto-roll-interval", payloadMs);
    } catch (e) {
      console.error(`Failed to send auto-roll interval to overlay ${id}:`, e.message);
    }
  }
  
  if (currentAutoRollInterval > 0) {
    console.log(`[settings] Auto-roll interval set to ${currentAutoRollInterval} seconds`);
  } else {
    console.log("[settings] Auto-roll interval reset to default");
  }
  // Update tray menu if it exists
  if (tray) {
    try {
      tray.setContextMenu(buildMenu());
    } catch (e) {
      console.error("Failed to update tray menu:", e.message);
    }
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
      <input type="range" id="intervalSlider" class="slider" min="1" max="60" value="${currentAutoRollInterval}">
    </div>
    <div class="value-display" id="valueDisplay">${currentAutoRollInterval > 0 ? currentAutoRollInterval + 's' : '3s'}</div>
    <button class="close-btn" onclick="window.close()">Close</button>
  </div>

  <script>
    const slider = document.getElementById('intervalSlider');
    const valueDisplay = document.getElementById('valueDisplay');
    
    slider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value, 10);
      valueDisplay.textContent = value > 0 ? (value + 's') : '3s';
      
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

function applyTableLayoutSettingsPatch(patch = {}) {
  const before = normalizeTableLayoutSettings(settings.tableLayout);
  const wasEnabled = before.enabled;
  let next = before;

  if (typeof patch.enabled === "boolean") {
    next = { ...next, enabled: patch.enabled };
  }
  if (typeof patch.autoArrange === "boolean") {
    next = { ...next, autoArrange: patch.autoArrange };
  }
  if (typeof patch.lockLayout === "boolean") {
    next = { ...next, lockLayout: patch.lockLayout };
  }
  for (const key of ["arrangeOnStartup", "restoreOnStop"]) {
    if (typeof patch[key] === "boolean") next = { ...next, [key]: patch[key] };
  }
  if (typeof patch.activeProfileId === "string") {
    const requestedId = String(patch.activeProfileId);
    if (next.profiles.some((profile) => profile.id === requestedId)) {
      next = { ...next, activeProfileId: requestedId };
    }
  }
  if (typeof patch.createProfileName === "string") {
    next = createLayoutProfile(next, patch.createProfileName);
  }
  if (patch.profile && typeof patch.profile === "object") {
    next = upsertLayoutProfile(next, patch.profile);
  }
  if (typeof patch.deleteProfileId === "string") {
    next = deleteLayoutProfile(next, patch.deleteProfileId);
  }

  next = normalizeTableLayoutSettings(next);
  const changed = JSON.stringify(before) !== JSON.stringify(next);
  settings.tableLayout = next;

  if (wasEnabled && !next.enabled) {
    tableLayoutManager.stop(next, "disabled");
  } else if (next.enabled && patch.applyNow === true) {
    requestTableLayoutApply();
  }

  return { changed, menuNeedsRefresh: changed || patch.applyNow === true };
}

function currentSettingsPayload() {
  const scanMs = Math.max(120, Number(settings.scanMs) || 300);
  return {
    quietMode,
    autoStartEnabled: settings.autoStartEnabled === true,
    scanMs,
    showOnlyActiveTables,
    showBuyInOverlay: settings.overlays.buyInEnabled !== false,
    showClockOverlay: settings.overlays.clockEnabled !== false,
    showStakeFrame: settings.overlays.stakeFrameEnabled !== false,
    appearance:normalizeAppearance(settings.appearance),
    comfort:normalizeComfort(settings.comfort),
    sessionFocus:normalizeSessionFocus(settings.sessionFocus),
    workspace:{enabled:settings.workspace.enabled,mode:workspacePlan?.mode||'inactive',message:workspacePlan?.message||'Workspace starts with automatic GG tables on the main display.'},
    autoRollSeconds: currentAutoRollInterval,
    session:{...comfortSession.status(settings.comfort),focusError},
    tableLayout: normalizeTableLayoutSettings(settings.tableLayout),
    displays: tableLayoutManager.getDisplays()
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
  if(patch.sessionFocus&&typeof patch.sessionFocus==='object'){updateSessionFocus(patch.sessionFocus);menuNeedsRefresh=true;}
  if(typeof patch.playing==='boolean')setPlayingState(patch.playing);
  if(typeof patch.workspaceEnabled==='boolean'&&patch.workspaceEnabled!==settings.workspace.enabled){
    settings.workspace.enabled=patch.workspaceEnabled;settingsChanged=true;workspacePlanKey='';
    destroySharedClock();requestTableLayoutApply();
  }

  if(patch.appearance && typeof patch.appearance==='object') {
    const previousGap=settings.appearance.rngGap;
    settings.appearance=patchAppearance(settings.appearance,patch.appearance);
    // Changing hand spacing or recalling a look deliberately restores its
    // hand-relative anchor; a size/opacity tweak preserves manual placement.
    if(settings.appearance.rngGap!==previousGap||patch.appearance.loadPreset||patch.appearance.reset)settings.overlays.position={...settings.overlays.position,mode:'hero-hand'};
    settingsChanged=true;refreshAllOverlayPositions('appearance');
  }
  if(patch.comfort && typeof patch.comfort==='object') {
    const previousMode=settings.comfort.clockMode;
    settings.comfort=normalizeComfort({...settings.comfort,...patch.comfort});settingsChanged=true;
    if(previousMode!==settings.comfort.clockMode) {
      destroySharedClock();
      for(const entry of overlays.values()) {
        try {entry.clockBw?.destroy();}catch{}
        entry.clockBw=null;entry.clockNativeIdKey=null;entry.clockStatusKey=null;
      }
      refreshAllOverlayPositions('clock-mode');
    }
  }
  if(typeof patch.breakAction==='string')applyBreakAction(patch.breakAction);

  if ("quietMode" in patch) {
    const nextQuiet = !!patch.quietMode;
    if (nextQuiet !== quietMode) {
      quietMode = nextQuiet;
      settings.quietMode = quietMode;
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
    if (nextActiveOnly !== showOnlyActiveTables) {
      showOnlyActiveTables = nextActiveOnly;
      settings.showOnlyActiveTables = showOnlyActiveTables;
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

  if ("showBuyInOverlay" in patch) {
    const nextBuyIn = !!patch.showBuyInOverlay;
    if (nextBuyIn !== (settings.overlays.buyInEnabled !== false)) {
      settings.overlays.buyInEnabled = nextBuyIn;
      settingsChanged = true;
      for (const entry of overlays.values()) {
        if (!nextBuyIn && entry.stakesBw && !entry.stakesBw.isDestroyed()) {
          try { entry.stakesBw.destroy(); } catch {}
          entry.stakesBw = null;
          entry.stakesNativeIdKey = null;
        }
      }
      if (nextBuyIn) {
        refreshAllOverlayPositions("buy-in-toggle");
      }
    }
  }

  if ("showClockOverlay" in patch) {
    const nextClock = !!patch.showClockOverlay;
    if (nextClock !== (settings.overlays.clockEnabled !== false)) {
      settings.overlays.clockEnabled = nextClock;
      settingsChanged = true;
      for (const entry of overlays.values()) {
        if (!nextClock && entry.clockBw && !entry.clockBw.isDestroyed()) {
          try { entry.clockBw.destroy(); } catch {}
          entry.clockBw = null;
          entry.clockNativeIdKey = null;
        }
      }
      if (nextClock) {
        refreshAllOverlayPositions("clock-toggle");
      }
    }
  }

  if (typeof patch.showStakeFrame === 'boolean' && patch.showStakeFrame !== settings.overlays.stakeFrameEnabled) {
    settings.overlays.stakeFrameEnabled = patch.showStakeFrame;
    settingsChanged = true;
    refreshAllOverlayPositions('stake-frame-toggle');
  }

  if ("autoRollSeconds" in patch) {
    setAutoRollInterval(patch.autoRollSeconds);
  }

  if (patch.tableLayout && typeof patch.tableLayout === "object") {
    const layoutResult = applyTableLayoutSettingsPatch(patch.tableLayout);
    if (layoutResult.changed) settingsChanged = true;
    if (layoutResult.menuNeedsRefresh) menuNeedsRefresh = true;
  }

  if (settingsChanged) {
    persistSettingsSnapshot(settings, "settings update");
  }

  if (scannerNeedsRestart) {
    startScanner();
  }

  if (menuNeedsRefresh && tray) {
    try {
      tray.setContextMenu(buildMenu());
    } catch (err) {
      console.error("[settings] Failed to refresh tray menu:", err.message);
    }
  }

  broadcastSettings();
  syncComfortWindows();
  return currentSettingsPayload();
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 820,
    minWidth: 480,
    minHeight: 680,
    resizable: true,
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

function senderMatchesWindow(sender, win) {
  return !!sender && !!win && !win.isDestroyed?.() && win.webContents?.id === sender.id;
}

function overlayEntryForSender(sender) {
  for (const [tableId, entry] of overlays) {
    if (entry.bw?.webContents?.id === sender?.id) {
      return { tableId, entry };
    }
  }
  return null;
}

function isSettingsSender(sender) {
  return senderMatchesWindow(sender, settingsWindow);
}

function isAutoRollIntervalSender(sender) {
  return senderMatchesWindow(sender, intervalSelectorWindow) || !!overlayEntryForSender(sender);
}

ipcMain.handle("settings:get", (event) => {
  if (!isSettingsSender(event.sender)) {
    throw new Error("Unauthorized settings sender");
  }
  return currentSettingsPayload();
});
ipcMain.handle("settings:update", (event, patch) => {
  if (!isSettingsSender(event.sender)) {
    throw new Error("Unauthorized settings sender");
  }
  return applySettingsPatch(patch || {});
});
// Session focus IPC exposes only the owned notes model, never general settings.
ipcMain.handle('session-focus:get',event=>{
  if(!sessionFocusPanel?.accepts(event.sender))throw new Error('Unauthorized session focus sender');
  return normalizeSessionFocus(settings.sessionFocus);
});
ipcMain.handle('session-focus:update',(event,patch)=>{
  if(!sessionFocusPanel?.accepts(event.sender))throw new Error('Unauthorized session focus sender');
  return updateSessionFocus(patch);
});
ipcMain.handle('clock:get',event=>{
  const status=clockStatusFor(event.sender);
  if(!status)throw new Error('Unauthorized clock sender');
  return status;
});
ipcMain.on('clock:action',(event,action)=>{
  if(!senderMatchesWindow(event.sender,sharedClockWindow))return;
  if(action==='start-playing'||action==='pause-playing')setPlayingState(action==='start-playing');
  else if(action==='restore-layout')requestTableLayoutApply();
  else applyBreakAction(action);
});

function buildMenu() {
  const layoutConfig = normalizeTableLayoutSettings(settings.tableLayout);
  const activeLayoutProfile = getActiveLayoutProfile(layoutConfig);
  return Menu.buildFromTemplate([
    { label: `Tables: ${overlays.size}`, enabled: false },
    ...buildSessionTrayItems({...comfortSession.status(settings.comfort),paused:!comfortSession.playing||!comfortSessionActive},{
      setPlaying:setPlayingState,breakAction:applyBreakAction,reset:resetSessionTimer
    }),
    {label:'Session focus',type:'checkbox',checked:settings.sessionFocus?.enabled!==false,click:()=>updateSessionFocusFromNative({enabled:settings.sessionFocus?.enabled===false})},
    { type: "separator" },
    { label: (scanTimer ? "Pause overlays" : "Resume overlays"), click: () => { scanTimer ? stopScanner() : startScanner(); } },
    { label: overlaysManuallyHidden ? "Show all overlays" : "Hide all overlays", click: () => {
      overlaysManuallyHidden = !overlaysManuallyHidden;
      console.log(`[tray] Toggled to: ${overlaysManuallyHidden ? 'HIDDEN' : 'VISIBLE'}`);
      
      // Immediately apply visibility change to all overlays
      for (const [id, entry] of overlays) {
        try {
          if (overlaysManuallyHidden) {
            entry.bw.hide();
            if (entry.stakesBw && !entry.stakesBw.isDestroyed()) entry.stakesBw.hide();
            if (entry.clockBw && !entry.clockBw.isDestroyed()) entry.clockBw.hide();
            try { entry.frameBw?.hide(); } catch {}
          } else {
            try {
              const win = entry.tableWin;
              const isVisible = isPokerTableWindowEffectivelyVisible(win, { knownPokerClient: true });
              const isMinimized = win?.isMinimized?.();
              const activeAllowed = !showOnlyActiveTables || win?.id === currentFocusedTableId;
              const canShow = isVisible && activeAllowed && entry.isOccluded !== true;
              if (!isMinimized && canShow) {
                entry.bw.showInactive();
                if (entry.stakesBw && !entry.stakesBw.isDestroyed()) entry.stakesBw.showInactive();
                if (entry.clockBw && !entry.clockBw.isDestroyed()) entry.clockBw.showInactive();
                try { updateStakeFrame(entry,getTableBounds(win)); } catch {}
              } else if (!activeAllowed) {
                logVerbose(`[tray] Skipping overlay ${id} (inactive table hidden)`);
              } else if (!isVisible) {
                logVerbose(`[tray] Skipping overlay ${id} (table not visible)`);
              }
            } catch (e) {}
          }
        } catch (e) {
          console.error(`[tray] Failed to toggle overlay ${id}:`, e.message);
        }
      }
      tray.setContextMenu(buildMenu());
    }},
    { label: showOnlyActiveTables ? "Show all visible tables" : "Show only active tables", click: () => {
      applySettingsPatch({ showOnlyActiveTables: !showOnlyActiveTables });
      console.log(`[tray] Show only active tables: ${showOnlyActiveTables ? "ON" : "OFF"}`);
    }},
    { type: "separator" },
    { label: `Table layout: ${layoutConfig.enabled ? activeLayoutProfile.name : "off"}`, enabled: false },
    { label: layoutConfig.enabled ? "Disable table layout" : "Enable table layout", click: () => {
      applySettingsPatch({ tableLayout: { enabled: !layoutConfig.enabled } });
    }},
    { label: "Arrange tables now", enabled: layoutConfig.enabled, click: () => {
      applySettingsPatch({ tableLayout: { applyNow: true } });
    }},
    {
      label: "Layout profile",
      enabled: layoutConfig.profiles.length > 0,
      submenu: layoutConfig.profiles.map((profile) => ({
        label: profile.name,
        type: "radio",
        checked: profile.id === layoutConfig.activeProfileId,
        click: () => applySettingsPatch({
          tableLayout: { activeProfileId: profile.id, applyNow: true }
        })
      }))
    },
    { type: "separator" },
    { label: `Auto-roll: ${currentAutoRollInterval > 0 ? `${currentAutoRollInterval}s` : "3s"}`, enabled: false },
    { label: "Set Interval...", click: () => openIntervalSelector() },
    { type: "separator" },
    { label: "Settings...", click: () => openSettingsWindow() },
    { label: quietMode ? "Enable verbose logging" : "Enable quiet mode", click: () => {
      applySettingsPatch({ quietMode: !quietMode });
    } },
    { label: (settings.autoStartEnabled ? "Disable Start with Windows" : "Enable Start with Windows"), click: () => {
      applySettingsPatch({ autoStartEnabled: !settings.autoStartEnabled });
    } },
    { type: "separator" },
    { label: "Quit", click: () => {
      console.log("[app] Quitting application...");
      appShuttingDown = true;
      stopScanner();
      tableLayoutManager.stop(liveTest?{...settings.tableLayout,restoreOnStop:false}:settings.tableLayout, "quit");
      globalShortcut.unregisterAll();

      // Destroy all overlays (main, stakes, clock)
      for (const entry of overlays.values()) {
        try { if (entry.bw) entry.bw.destroy(); } catch {}
        try { if (entry.stakesBw) entry.stakesBw.destroy(); } catch {}
        try { if (entry.clockBw) entry.clockBw.destroy(); } catch {}
        try { entry.frameBw?.destroy(); } catch {}
      }
      overlays.clear();
      sessionFocusPanel?.destroy();

      if (settingsWindow && !settingsWindow.isDestroyed()) {
        try { settingsWindow.destroy(); } catch {}
      }
      if (tray) {
        try { tray.destroy(); } catch {}
      }
      app.quit();
    }}
  ]);
}

function createTray() {
  if(isolatedRun)return;
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
    return;
  }
  
  tray.setToolTip("Poker RNG Overlays");
  tray.setContextMenu(buildMenu());
  
  // Add click handler for better responsiveness
  tray.on('click', () => {
    console.log("[tray] Tray clicked");
  });
  
  tray.on('right-click', () => {
    console.log("[tray] Tray right-clicked");
    tray.popUpContextMenu();
  });
}

function registerShortcuts() {
  if(isolatedRun)return;
  try {
    const registered = globalShortcut.register("Alt+H", () => {
      overlaysManuallyHidden = !overlaysManuallyHidden;
      console.log(`[ALT+H] Toggled to: ${overlaysManuallyHidden ? 'HIDDEN' : 'VISIBLE'}`);
      
      // Immediately apply visibility change to all overlays
      for (const [id, entry] of overlays) {
        try {
          if (overlaysManuallyHidden) {
            // Hide all overlays
            entry.bw.hide();
            if (entry.stakesBw && !entry.stakesBw.isDestroyed()) entry.stakesBw.hide();
            if (entry.clockBw && !entry.clockBw.isDestroyed()) entry.clockBw.hide();
            try { entry.frameBw?.hide(); } catch {}
            console.log(`[ALT+H] ❌ Hid overlay for table ${id}`);
          } else {
            // Show all overlays (only if table is visible and not minimized)
            try {
              const win = entry.tableWin;
              const isVisible = isPokerTableWindowEffectivelyVisible(win, { knownPokerClient: true });
              const isMinimized = win?.isMinimized?.();
              const activeAllowed = !showOnlyActiveTables || win?.id === currentFocusedTableId;
              const canShow = isVisible && activeAllowed && entry.isOccluded !== true;
              
              if (!isMinimized && canShow) {
                entry.bw.showInactive();
                if (entry.stakesBw && !entry.stakesBw.isDestroyed()) entry.stakesBw.showInactive();
                if (entry.clockBw && !entry.clockBw.isDestroyed()) entry.clockBw.showInactive();
                try { updateStakeFrame(entry,getTableBounds(win)); } catch {}
                console.log(`[ALT+H] ✅ Showed overlay for table ${id}`);
              } else if (!activeAllowed) {
                console.log(`[ALT+H] Skipped overlay for table ${id} (inactive table hidden)`);
              } else if (!isVisible) {
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

    const layoutRegistered = globalShortcut.register("Ctrl+Alt+T", () => {
      if (settings.tableLayout?.enabled !== true) {
        logVerbose("[layout] Ctrl+Alt+T ignored because table layout is disabled");
        return;
      }
      requestTableLayoutApply();
      logVerbose("[layout] Ctrl+Alt+T requested a table rearrange");
    });
    if (!layoutRegistered) {
      console.warn("[layout] Ctrl+Alt+T registration failed; another app may be using it");
    }
    
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

  app.on("window-all-closed", () => {}); // Keep the tray app alive with no tables.

  app.whenReady().then(() => {
    console.log("[app] whenReady()");
    if(!isolatedRun)app.setAppUserModelId("PokerRNG");

    // Handle IPC messages
    ipcMain.on('stake-frame-drawn',(event,state) => {
      const entry = Array.from(overlays.values()).find(e=>e.frameBw?.webContents?.id===event.sender.id);
      if (!entry || !state || state.version !== entry.frameVersion || typeof state.painted !== 'boolean') return;
      entry.framePainted = {...state,at:new Date().toISOString()};
      queueFrameDiagnostics();
    });
    ipcMain.on("set-auto-roll-interval", (event, seconds) => {
      if (!isAutoRollIntervalSender(event.sender)) return;
      setAutoRollInterval(seconds);
    });
    ipcMain.on("rng-value", (event, value, rollId) => {
      const record = overlayEntryForSender(event.sender);
      if (!record) return;
      if (!commitRngRoll(record.entry, value, rollId)) return;
      isolatedRun?.recordRngCommit(event.sender,{tableId:record.tableId,value,rollId});
      logVerbose(`[rng] Committed ${value} (roll ${rollId}) for "${record.entry.lastTitle || "table"}"`);
    });
    ipcMain.on("rng-clicked", (event, requestedReason = "manual") => {
      const record = overlayEntryForSender(event.sender);
      if (!record) return;
      const { tableId, entry } = record;
      const reason = ["initial", "interval"].includes(requestedReason) ? requestedReason : "manual";
      if (reason === "initial" && entry.rngRollId > 0) {
        event.sender.send("roll-now", { value: entry.lastRngValue, rollId: entry.rngRollId });
        return;
      }
      triggerRollForTable(tableId, `overlay-${reason}`, {
        window: entry.tableWin,
        bypassRecognition: true,
        forceRepeat: true
      }).finally(() => {
        if (reason !== "manual"||isolatedRun) return;
        setTimeout(() => {
          try { entry.tableWin?.bringToTop?.(); } catch {}
        }, 50);
      });
    });

    console.log("[app] setAutoStart begin");
    setAutoStart(settings.autoStartEnabled === true);
    console.log("[app] startScanner begin");
    try{initializeFocusWindows();}catch(error){focusError='Focus recovery needs attention';console.error('[focus] Recovery failed:',error.message);}
    startScanner();
    console.log("[app] startSessionTimer begin");
    startSessionTimer();
    console.log("[app] createTray begin");
    createTray();
    console.log("[app] registerShortcuts begin");
    registerShortcuts();
    writeFrameDiagnostics();
    console.log("[app] startup complete");
  }).catch((err) => {
    console.error("[app] whenReady error:", err);
  });
}

app.on("will-quit", (event) => {
  console.log("[app] Will quit event triggered");
  appShuttingDown = true;
  stopScanner();
  tableLayoutManager.stop(liveTest?{...settings.tableLayout,restoreOnStop:false}:settings.tableLayout, "quit");
  stopSessionTimer();
  destroySharedClock();
  globalShortcut.unregisterAll();
  
  // Destroy all overlays (main, stakes, clock)
  for (const entry of overlays.values()) {
    try { if (entry.bw) entry.bw.destroy(); } catch {}
    try { if (entry.stakesBw) entry.stakesBw.destroy(); } catch {}
    try { if (entry.clockBw) entry.clockBw.destroy(); } catch {}
    try { entry.frameBw?.destroy(); } catch {}
  }
  overlays.clear();
  if (frameDiagnosticsTimer) clearTimeout(frameDiagnosticsTimer);
  frameDiagnosticsTimer = null;
  writeFrameDiagnostics();
  
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
  sessionFocusPanel?.destroy();
  restoreFocusWindows();
  if (overlayAnchorPersistTimer) {
    clearTimeout(overlayAnchorPersistTimer);
    overlayAnchorPersistTimer = null;
    persistSettingsSnapshot(settings, "RNG overlay position before quit");
  }
  // Allow the quit to proceed
});
