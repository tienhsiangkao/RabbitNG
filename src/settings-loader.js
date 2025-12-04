import fs from "fs";
import path from "path";

function ensureUserSettingsDir(userSettingsPath, canPersistUserSettings) {
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

export function initializeSettings(app) {
  const packagedSettingsPath = path.join(app.getAppPath(), "settings.json");
  let userSettingsPath = packagedSettingsPath;
  try {
    userSettingsPath = path.join(app.getPath("userData"), "settings.json");
  } catch (err) {
    console.error(
      "[settings] Unable to resolve userData path; settings will fall back to packaged defaults:",
      err.message
    );
  }
  const canPersistUserSettings = userSettingsPath !== packagedSettingsPath;

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
        ensureUserSettingsDir(userSettingsPath, canPersistUserSettings);
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
      ensureUserSettingsDir(userSettingsPath, canPersistUserSettings);
      fs.writeFileSync(userSettingsPath, JSON.stringify(settingsObj, null, 2), "utf8");
    } catch (err) {
      console.error(`Failed to save ${context}:`, err.message);
    }
  }

  const defaultTurnRecognition = {
    enabled: false,
    strategy: "color-sample",
    minMatches: 1,
    samples: [],
    tolerance: 35,
    cacheMs: 150,
    triggerOnVisibilityChange: false,
    logOnSkip: true
  };

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

  const defaultOverlayConfig = {
    basePctSmall: 0.08,
    basePctLarge: 0.12,
    minW: 64,
    minH: 48,
    anchor: { xPct: 0.37, yPct: 0.85 },
    position: { mode: "anchor", edge: "top-right", padX: 24, padY: 24 },
    stakesEnabled: true,
    clockEnabled: true,
    rememberDefaultOnDrag: true
  };

  function mergeOverlayConfig(existing = {}) {
    return {
      ...defaultOverlayConfig,
      ...existing,
      anchor: { ...defaultOverlayConfig.anchor, ...(existing.anchor || {}) },
      position: { ...defaultOverlayConfig.position, ...(existing.position || {}) }
    };
  }

  function coerceSettings(raw) {
    const next = { ...raw };
    next.scanMs = Math.max(120, Math.min(2000, Number(next.scanMs) || 300));
    const autoRollMs = Number(next.autoRollMs) || 0;
    next.autoRollMs = autoRollMs > 0 ? Math.min(60000, Math.max(1000, autoRollMs)) : 0;
    next.quietMode = next.quietMode !== false;
    next.autoStartEnabled = next.autoStartEnabled === true;
    next.showOnlyActiveTables = next.showOnlyActiveTables === true;
    next.strictBeginsOnly = next.strictBeginsOnly === true;
    return next;
  }

  const settings = coerceSettings(loadSettingsSnapshot());
  settings.turnRecognition = { ...defaultTurnRecognition, ...settings.turnRecognition };
  settings.colorTierRules = mergeColorTierRules(settings.colorTierRules);
  settings.overlays = mergeOverlayConfig(settings.overlays);
  return {
    settings,
    persistSettingsSnapshot,
    defaultTurnRecognition,
    defaultColorTierRules,
    defaultOverlayConfig,
    mergeColorTierRules,
    mergeOverlayConfig,
    paths: {
      packagedSettingsPath,
      userSettingsPath,
      canPersistUserSettings
    }
  };
}
