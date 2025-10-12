// // Overlays + autostart + tray — transparent overlay + table-size IPC + ICONS (dev/prod safe)
// import { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage } from "electron";
// import path from "path";
// import { windowManager } from "node-window-manager";
// import fs from "fs";

// let overlays = new Map();
// let scanTimer = null;
// let tray = null;

// // ---- App / Tray icon path (works in dev and packaged EXE) ----
// const isDev = !app.isPackaged;
// const iconPath = isDev
//   ? path.join(app.getAppPath(), "assets", "icons", "app.ico")
//   : path.join(process.resourcesPath, "assets", "icons", "app.ico");

// try { console.log("Tray icon path:", iconPath, "exists:", fs.existsSync(iconPath)); } catch {}

// function isPokerTable(win) {
//   try {
//     if (!win.isVisible()) return false;
//     const titleRaw = win.getTitle() || "";
//     // flexible: ignore leading spaces, case-insensitive, and still begins-with
//     return /^\s*Rush & Cash/i.test(titleRaw);
//   } catch {
//     return false;
//   }
// }


// function getTableBounds(win) { return win.getBounds(); }

// // Overlay rectangle (top-left with your offsets)
// function overlayRectFor(b) {
//   const width  = Math.max(120, Math.floor(b.width * 0.12));
//   const height = Math.max(90,  Math.floor(b.height * 0.12));
//   const x = b.x + Math.floor(b.width * 0.30);
//   const y = b.y + Math.floor(b.height * 0.75);
//   return { x, y, width, height };
// }

// function createOverlayFor(win) {
//   const id = win.id;
//   const tbl = getTableBounds(win);
//   const r = overlayRectFor(tbl);

//   const bw = new BrowserWindow({
//     x: r.x, y: r.y, width: r.width, height: r.height,
//     frame: false,
//     transparent: true,
//     backgroundColor: "#00000000",
//     resizable: false,
//     alwaysOnTop: true,
//     focusable: false,
//     skipTaskbar: true,
//     hasShadow: false,
//     show: false,
//     icon: iconPath,
//     webPreferences: {
//       preload: path.join(app.getAppPath(), "preload.cjs"),
//       contextIsolation: true,
//       nodeIntegration: false
//     }
//   });

//   try { bw.setIgnoreMouseEvents(false); } catch {}
//   try { bw.setAlwaysOnTop(true, "screen-saver"); } catch { bw.setAlwaysOnTop(true); }
//   try { bw.setAspectRatio(0.75); } catch {}

//   bw.loadFile(path.join(app.getAppPath(), "index.html")).catch(err => console.error("overlay load:", err));
//   bw.once("ready-to-show", () => {
//     bw.showInactive();
//     try { bw.webContents.send("table-size", { width: tbl.width, height: tbl.height }); } catch {}
//   });

//   overlays.set(id, { bw, lastBounds: r });
// }

// function updateOverlayPosition(win) {
//   const entry = overlays.get(win.id);
//   if (!entry) return;
//   const tbl = getTableBounds(win);
//   const r = overlayRectFor(tbl);

//   entry.bw.setBounds(r, false);
//   try { entry.bw.moveTop(); } catch {}
//   try { entry.bw.webContents.send("table-size", { width: tbl.width, height: tbl.height }); } catch {}

//   entry.lastBounds = r;
// }

// function cleanupMissing(currentIds) {
//   for (const [id, { bw }] of overlays) {
//     if (!currentIds.has(id)) { try { bw.destroy(); } catch {} overlays.delete(id); }
//   }
// }

// function scanTables() {
//   const wins = windowManager.getWindows().filter(isPokerTable);
//   const ids = new Set(wins.map(w => w.id));
//   for (const w of wins) overlays.has(w.id) ? updateOverlayPosition(w) : createOverlayFor(w);
//   cleanupMissing(ids);
// }

// function startScanner() { if (scanTimer) clearInterval(scanTimer); scanTimer = setInterval(scanTables, 300); }
// function stopScanner()  { if (scanTimer) { clearInterval(scanTimer); scanTimer = null; } }

// function setAutoStart(enabled) {
//   app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, args: [] });
// }
// function isAutoStartEnabled() { return !!app.getLoginItemSettings().openAtLogin; }

// function createTray() {
//   let img = nativeImage.createFromPath(iconPath);
//   if (img.isEmpty()) {
//     const pngFallback = iconPath.replace(/\.ico$/i, ".png");
//     const tryPng = nativeImage.createFromPath(pngFallback);
//     if (!tryPng.isEmpty()) img = tryPng;
//   }
//   if (img.isEmpty()) img = nativeImage.createEmpty();

//   tray = new Tray(img);
//   const buildMenu = () => Menu.buildFromTemplate([
//     { label: (scanTimer ? "Pause overlays" : "Resume overlays"), click: () => { scanTimer ? stopScanner() : startScanner(); } },
//     { label: (isAutoStartEnabled() ? "Disable Start with Windows" : "Enable Start with Windows"), click: () => { setAutoStart(!isAutoStartEnabled()); tray.setContextMenu(buildMenu()); } },
//     { type: "separator" },
//     { label: "Quit", click: () => app.quit() }
//   ]);
//   tray.setToolTip("Poker RNG Overlays");
//   tray.setContextMenu(buildMenu());
// }

// function registerShortcuts() {
//   try {
//     globalShortcut.register("Alt+H", () => {
//       const anyVisible = [...overlays.values()].some(({ bw }) => bw.isVisible());
//       for (const { bw } of overlays.values()) { try { anyVisible ? bw.hide() : bw.showInactive(); } catch {} }
//     });
//   } catch (e) { console.error("Alt+H failed", e); }
// }

// // Keep app running in tray even if all windows are closed
// app.on("window-all-closed", (e) => e.preventDefault());

// app.whenReady().then(() => {
//   app.setAppUserModelId("PokerRNG");
//   if (!app.requestSingleInstanceLock()) { app.quit(); return; }
//   app.on("second-instance", () => { for (const { bw } of overlays.values()) try { bw.moveTop(); } catch {} });

//   setAutoStart(true);
//   startScanner();
//   createTray();
//   registerShortcuts();
// });

// app.on("will-quit", () => {
//   stopScanner();
//   globalShortcut.unregisterAll();
//   for (const { bw } of overlays.values()) { try { bw.destroy(); } catch {} }
//   overlays.clear();
// });
// main.js — fixed overlay position per table (no drag, no user-move)
// Clean single import line (prevents “app already declared”)
// Fixed-position overlays (no drag), per-table, autoroll, tray controls
// Cross-platform main.js
// - Windows: multi-overlay using node-window-manager
// - macOS: active-window overlay using active-win (one overlay follows focused table)
// - Keeps tray, autoroll, settings, opacity, etc.

import { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, shell } from "electron";
import path from "path";
import fs from "fs";

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

// Lazy imports so Windows-only/mac-only deps don’t break the other OS
let windowManager = null;                   // Windows
let getActiveWin = null;                    // macOS

if (isWin) {
  ({ windowManager } = await import("node-window-manager"));
} else if (isMac) {
  const mod = await import("active-win");
  getActiveWin = mod.default;
}

// ===== Globals =====
let overlays = new Map();  // Map<tableId, { bw, lastRect, visible, lastSeenAt, staleSince }>
let scanTimer = null;
let tray = null;

// Autoroll
let autoRollTimer = null;
let autoRollMs = 0;

// Cleanup timers
const STALE_HIDE_MS = 0;
const STALE_DESTROY_MS = 1000;

// Paths
const isDev = !app.isPackaged;
const exeDir = isDev ? app.getAppPath() : path.dirname(process.execPath);

const settingsPath = [
  path.join(exeDir, "settings.json"),
  path.join(app.getAppPath(), "settings.json"),
  path.join(process.resourcesPath || exeDir, "settings.json"),
].find(p => fs.existsSync(p)) || path.join(exeDir, "settings.json");

const iconPath = (() => {
  // Windows tray prefers .ico, mac prefers .png; we’ll try both
  const ico = path.join(exeDir, "assets", "icons", "app.ico");
  const png = path.join(exeDir, "assets", "icons", "app.png");
  if (fs.existsSync(isWin ? ico : png)) return isWin ? ico : png;
  const resIco = path.join(process.resourcesPath || exeDir, "assets", "icons", "app.ico");
  const resPng = path.join(process.resourcesPath || exeDir, "assets", "icons", "app.png");
  return fs.existsSync(isWin ? resIco : resPng) ? (isWin ? resIco : resPng) : (fs.existsSync(png) ? png : ico);
})();

const dumpPath = path.join(exeDir, "windows_dump.txt");

// ===== Settings (shared) =====
let S = {
  scanMs: 300,
  followActiveOnly: isMac ? true : false, // mac = forced active-only mode
  opacity: 1.0,
  clickThrough: false,
  strictBeginsOnly: true,   // title must begin with a prefix
  autoRollMs: 0,

  overlays: {
    basePctSmall: 0.08,
    basePctLarge: 0.12,
    minW: 64,
    minH: 48,
    anchor: { xPct: 0.30, yPct: 0.75 },
  },

  excludeTitlePrefixes: ["HH","Hand History","History","Lobby","Cashier","Settings","Options","Replayer","Replay","Observer"],

  matchers: [
    {
      name: "GGPoker",
      titlePrefixes: ["Rush & Cash", "NLH", "[#] NLH"],
      titleKeywords: ["Rush","Cash","NLH","PLO","Table"],
      classIncludes: ["GGPoker","GGNetwork"]
    }
  ]
};

function normTitle(t) {
  return String(t || "").replace(/^\s*(\[#\]\s*)+/, "").trim();
}

function readSettingsFile() { try { return JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch { return {}; } }
function saveSettingsPartial(patch) {
  try {
    const cur = readSettingsFile();
    const next = { ...cur, ...patch };
    fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2), "utf8");
  } catch (e) { console.error("[settings] save failed:", e.message); }
}
function writeDefaultsIfMissing() {
  if (!fs.existsSync(settingsPath)) {
    try { fs.writeFileSync(settingsPath, JSON.stringify(S, null, 2), "utf8"); } catch {}
  }
}
function loadSettings() {
  try {
    writeDefaultsIfMissing();
    const obj = readSettingsFile();
    S = {
      ...S,
      ...obj,
      overlays: { ...S.overlays, ...(obj.overlays || {}), anchor: { ...S.overlays.anchor, ...(obj.overlays?.anchor || {}) } },
      matchers: Array.isArray(obj.matchers) && obj.matchers.length ? obj.matchers : S.matchers,
      excludeTitlePrefixes: Array.isArray(obj.excludeTitlePrefixes) ? obj.excludeTitlePrefixes : S.excludeTitlePrefixes
    };
    if (isMac) S.followActiveOnly = true; // force on mac

    for (const { bw } of overlays.values()) {
      try { bw.setOpacity(Math.max(0.2, Math.min(1.0, Number(S.opacity) || 1.0))); } catch {}
      try { bw.setIgnoreMouseEvents(!!S.clickThrough, { forward: true }); } catch {}
    }
    setAutoRoll(S.autoRollMs || 0, true);
    startScanner();
    console.log(`[settings] loaded | mac=${isMac} | strictBeginsOnly=${S.strictBeginsOnly} | autoRollMs=${S.autoRollMs}`);
  } catch (e) {
    console.error("[settings] load failed:", e.message);
  }
}
function watchSettings() {
  try { fs.watchFile(settingsPath, { interval: 1000 }, () => { console.log("[settings] changed"); loadSettings(); if (tray) tray.setContextMenu(buildTrayMenu()); }); } catch {}
}

// ===== Match helpers =====
function beginsWithOne(title, prefixes) {
  if (!prefixes || !prefixes.length) return false;
  for (const pfx of prefixes) {
    const re = new RegExp("^\\s*" + pfx.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&"));
    if (re.test(title)) return true;
  }
  return false;
}
function containsOne(title, keywords) {
  if (!keywords || !keywords.length) return false;
  const t = title.toLowerCase();
  return keywords.some(k => t.includes(String(k).toLowerCase()));
}
function beginsWithNone(title, prefixes) { return !prefixes?.length ? true : !beginsWithOne(title, prefixes); }

// ===== Geometry / overlay rect =====
function overlayRectFor(b) {
  const T = (b.width - 800) / (1400 - 800);
  const t = Math.max(0, Math.min(1, T));
  const pct = S.overlays.basePctSmall * (1 - t) + S.overlays.basePctLarge * t;
  const width  = Math.max(S.overlays.minW, Math.floor(b.width  * pct));
  const height = Math.max(S.overlays.minH, Math.floor(b.height * pct));
  const x = b.x + Math.floor(b.width  * S.overlays.anchor.xPct);
  const y = b.y + Math.floor(b.height * S.overlays.anchor.yPct);
  return { x, y, width, height };
}
function rectEq(a, b) { return a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height; }

// ===== Create / update overlay =====
function createOverlayForId(tableId, tableBounds) {
  const r = overlayRectFor(tableBounds);
  const bw = new BrowserWindow({
    x: r.x, y: r.y, width: r.width, height: r.height,
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
    webPreferences: {
      preload: path.join(app.getAppPath(), "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  try { bw.setIgnoreMouseEvents(!!S.clickThrough, { forward: true }); } catch {}
  try { bw.setAlwaysOnTop(true, "screen-saver"); } catch { bw.setAlwaysOnTop(true); }
  try { bw.setOpacity(Math.max(0.2, Math.min(1.0, Number(S.opacity) || 1.0))); } catch {}
  try { bw.setAspectRatio(0.75); } catch {}

  bw.loadFile(path.join(app.getAppPath(), "index.html")).catch(err => console.error("overlay load:", err));
  bw.once("ready-to-show", () => { try { bw.webContents.send("table-size", { width: tableBounds.width, height: tableBounds.height }); } catch {} });

  overlays.set(tableId, { bw, lastRect: r, visible: false, lastSeenAt: Date.now(), staleSince: null });
  return overlays.get(tableId);
}
function updateOverlayForId(tableId, tableBounds) {
  const entry = overlays.get(tableId);
  if (!entry) return;
  const r = overlayRectFor(tableBounds);
  if (!rectEq(entry.lastRect, r)) { entry.bw.setBounds(r, false); entry.lastRect = r; }
  try { entry.bw.webContents.send("table-size", { width: tableBounds.width, height: tableBounds.height }); } catch {}
  entry.lastSeenAt = Date.now();
  entry.staleSince = null;
}
function setVisible(entry, show) {
  if (show && !entry.visible) { try { entry.bw.showInactive(); } catch {} entry.visible = true; }
  else if (!show && entry.visible) { try { entry.bw.hide(); } catch {} entry.visible = false; }
}
function destroyOverlayEntry(id, entry) { try { setVisible(entry, false); } catch {} try { entry.bw.destroy(); } catch {} overlays.delete(id); }

// ===== Windows scanner (multi-overlay) =====
function isZeroLikeBounds(b){ return !b || b.width <= 1 || b.height <= 1; }
function isAbsurdSize(b){ return b.width > 20000 || b.height > 20000; }
function isMinimized(w){ try { return !!w.isMinimized?.(); } catch { return false; } }
function isVisible(w){ try { return !!w.isVisible?.(); } catch { return true; } }

function isPokerTableWin(w) {
  try {
    const rawTitle = w.getTitle?.() || "";
    const title = normTitle(rawTitle);
    const b = w.getBounds?.() || { width:0, height:0 };
    if (!isVisible(w) || isMinimized(w) || isZeroLikeBounds(b) || isAbsurdSize(b)) return false;
    if (!beginsWithNone(title, S.excludeTitlePrefixes)) return false;
    for (const m of S.matchers) if (beginsWithOne(title, m.titlePrefixes)) return true;
    return false;
  } catch { return false; }
}
function scanWindows() {
  const now = Date.now();
  const all = windowManager.getWindows();
  const tables = [];
  for (const w of all) { try { if (isPokerTableWin(w)) tables.push(w); } catch {} }
  const currentIds = new Set(tables.map(w => w.id));

  for (const w of tables) {
    const b = w.getBounds();
    if (!overlays.has(w.id)) createOverlayForId(w.id, b);
    updateOverlayForId(w.id, b);
  }
  // Show all (Windows default) or only active if enabled
  if (S.followActiveOnly) {
    const active = windowManager.getActiveWindow();
    const aid = active?.id ?? null;
    for (const w of tables) {
      const entry = overlays.get(w.id);
      setVisible(entry, w.id === aid);
      if (w.id === aid) { try { entry.bw.moveTop(); } catch {} }
    }
  } else {
    for (const w of tables) { const entry = overlays.get(w.id); setVisible(entry, true); }
  }
  for (const [id, entry] of overlays) if (!currentIds.has(id)) {
    if (entry.staleSince == null) entry.staleSince = now;
    if (now - entry.staleSince >= STALE_HIDE_MS) setVisible(entry, false);
    if (now - entry.staleSince >= STALE_DESTROY_MS) destroyOverlayEntry(id, entry);
  }
}

// ===== macOS scanner (active-window only) =====
async function scanMac() {
  const info = await getActiveWin().catch(() => null);
  if (!info) return;
  const rawTitle = info.title || "";
  const title = normTitle(rawTitle);
  const b = { x: info.bounds.x, y: info.bounds.y, width: info.bounds.width, height: info.bounds.height };

  // Filter by title begins-with
  if (!beginsWithNone(title, S.excludeTitlePrefixes)) {
    // hide all overlays if active window is excluded
    for (const [id, e] of overlays) setVisible(e, false);
    return;
  }
  let isMatch = false;
  for (const m of S.matchers) if (beginsWithOne(title, m.titlePrefixes)) { isMatch = true; break; }
  if (!isMatch) { for (const [id, e] of overlays) setVisible(e, false); return; }

  const tableId = `mac-${info.pid}-${info.id}`; // unique per window
  if (!overlays.has(tableId)) createOverlayForId(tableId, b);
  updateOverlayForId(tableId, b);

  // mac = active-only: show current, hide any others
  for (const [id, e] of overlays) setVisible(e, id === tableId);
}

// ===== Scan loop =====
function scanTables() {
  if (isWin) scanWindows();
  else if (isMac) { scanMac(); }
}

// ===== Scanner control =====
function startScanner() { if (scanTimer) clearInterval(scanTimer); scanTimer = setInterval(scanTables, Math.max(120, Number(S.scanMs) || 300)); }
function stopScanner()  { if (scanTimer) { clearInterval(scanTimer); scanTimer = null; } }

// ===== Autoroll =====
function setAutoRoll(ms, fromSettings = false) {
  if (autoRollTimer) { clearInterval(autoRollTimer); autoRollTimer = null; }
  autoRollMs = Number(ms) || 0;
  if (!fromSettings) { S.autoRollMs = autoRollMs; saveSettingsPartial({ autoRollMs }); }
  if (autoRollMs > 0) {
    autoRollTimer = setInterval(() => {
      for (const { bw } of overlays.values()) { try { if (!bw.isDestroyed()) bw.webContents.send("roll-now"); } catch {} }
    }, autoRollMs);
  }
  if (tray) tray.setContextMenu(buildTrayMenu());
}

// ===== Autostart =====
function setAutoStart(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, args: [] });
}
function isAutoStartEnabled() { return !!app.getLoginItemSettings().openAtLogin; }

// ===== Tray =====
function buildTrayMenu() {
  const autoPicks = [0,5000,10000,15000,30000,60000];
  const autoLabels = { 0:"Off",5000:"Every 5s",10000:"Every 10s",15000:"Every 15s",30000:"Every 30s",60000:"Every 60s" };

  const items = [
    { label: (scanTimer ? "Pause overlays" : "Resume overlays"), click: () => { scanTimer ? stopScanner() : startScanner(); } },
    ...(isWin ? [{
      label: (S.followActiveOnly ? "Show on ALL tables" : "Show only FOCUSED table"),
      click: () => { S.followActiveOnly = !S.followActiveOnly; tray.setContextMenu(buildTrayMenu()); }
    }] : [{ label: "macOS mode: follows focused table (single overlay)", enabled: false }]),
    { type: "separator" },
    { label: (S.clickThrough ? "Disable Click-through" : "Enable Click-through"),
      click: () => { S.clickThrough = !S.clickThrough; for (const { bw } of overlays.values()) try { bw.setIgnoreMouseEvents(S.clickThrough, { forward:true }); } catch {}; tray.setContextMenu(buildTrayMenu()); } },
    {
      label: `Auto-roll (${autoLabels[autoRollMs] || `${autoRollMs}ms`})`,
      submenu: autoPicks.map(ms => ({ label: autoLabels[ms] + (ms===autoRollMs ? "  ✓":""), click: () => setAutoRoll(ms) }))
    },
    {
      label: `Opacity (${Math.round((S.opacity||1)*100)}%)`,
      submenu: [1.0,0.85,0.75,0.6,0.5,0.4,0.3].map(v => ({
        label: `${Math.round(v*100)}%` + (Math.abs((S.opacity||1)-v) < 0.001 ? "  ✓" : ""),
        click: () => { S.opacity = v; for (const { bw } of overlays.values()) try { bw.setOpacity(v); } catch {}; tray.setContextMenu(buildTrayMenu()); }
      }))
    },
    { type: "separator" },
    { label: "Reload settings.json", click: () => loadSettings() },
    { label: "Open settings folder", click: () => shell.openPath(path.dirname(settingsPath)) },
    ...(isMac ? [
      { type:"separator" },
      { label: "Grant Accessibility…", click: () => shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") },
      { label: "Grant Screen Recording…", click: () => shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") },
    ] : []),
    { type: "separator" },
    { label: (isAutoStartEnabled() ? "Disable Start at Login" : "Enable Start at Login"),
      click: () => { setAutoStart(!isAutoStartEnabled()); tray.setContextMenu(buildTrayMenu()); } },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() }
  ];

  return Menu.buildFromTemplate(items);
}
function createTray() {
  let img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) img = nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip("Poker RNG Overlays");
  tray.setContextMenu(buildTrayMenu());
}

// ===== Shortcuts & lifecycle =====
function registerShortcuts() {
  try {
    globalShortcut.register("Alt+H", () => {
      const anyVisible = [...overlays.values()].some(e => e.visible);
      for (const e of overlays.values()) setVisible(e, !anyVisible);
    });
  } catch {}
}
app.on("window-all-closed", (e) => e.preventDefault());

app.whenReady().then(() => {
  if (isMac && app.dock) app.dock.hide(); // keep it tray-only if you like
  if (isWin) app.setAppUserModelId("PokerRNG");

  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on("second-instance", () => { for (const e of overlays.values()) try { e.bw.moveTop(); } catch {} });

  loadSettings();
  watchSettings();
  startScanner();
  createTray();
  registerShortcuts();
});

app.on("will-quit", () => {
  stopScanner();
  if (autoRollTimer) clearInterval(autoRollTimer);
  globalShortcut.unregisterAll();
  for (const e of overlays.values()) { try { e.bw.destroy(); } catch {} }
  overlays.clear();
});
