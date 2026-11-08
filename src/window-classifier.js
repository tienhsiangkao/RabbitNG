import path from "path";

const BROWSER_EXECUTABLES = new Set([
  "chrome.exe",
  "msedge.exe",
  "firefox.exe",
  "brave.exe",
  "opera.exe",
  "opera_gx.exe",
  "vivaldi.exe",
  "arc.exe",
  "thorium.exe",
  "waterfox.exe",
  "librewolf.exe"
]);

const POKER_EXECUTABLES = new Set([
  "ggnet.exe",
  "ggpoker.exe",
  "ggpcom.exe",
  "natural8.exe",
  "natural8net.exe",
  "coinpoker.exe"
]);

const POKER_CLASS_TOKENS = [
  "ggpoker",
  "ggnetwork",
  "ggnet",
  "natural8",
  "coinpoker"
];

const BROWSER_TITLE_SUFFIX =
  /\s[-\u2013\u2014]\s(?:Google Chrome|Microsoft Edge|Mozilla Firefox|Brave|Opera|Vivaldi|Arc)$/i;

const DEFAULT_NON_TABLE_TITLE_KEYWORDS = [
  "HH",
  "Hand History",
  "History",
  "Replay",
  "Replayer",
  "Observer",
  "Lobby",
  "Tournament Lobby",
  "Cashier",
  "Settings",
  "Options",
  "Chat",
  "Message",
  "Messages",
  "Inbox",
  "Notes",
  "Support",
  "Help",
  "Promotion",
  "Promotions",
  "Leaderboard",
  "Balance",
  "Transaction",
  "Transactions",
  "Account",
  "My Page",
  "Smart HUD"
];

function executableName(win) {
  return path.win32.basename(String(win?.path || win?.processPath || "")).toLowerCase();
}

function executablePath(win) {
  return path.win32.normalize(String(win?.path || win?.processPath || "")).toLowerCase();
}

function processName(win) {
  try {
    return String(win?.getProcessName?.() || win?.processName || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

function className(win) {
  try {
    return String(win?.getClassName?.() || win?.className || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

function normalizeWindowTitle(title) {
  return String(title || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleHasKeyword(title, keyword) {
  const normalizedKeyword = normalizeWindowTitle(keyword);
  if (!normalizedKeyword) return false;

  const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(normalizedKeyword)}(?=$|[^A-Za-z0-9])`, "i");
  return pattern.test(title);
}

function titleStartsWithAny(title, prefixes) {
  if (!Array.isArray(prefixes) || prefixes.length === 0) return false;

  const lowerTitle = title.toLowerCase();
  return prefixes.some((prefix) => {
    const normalizedPrefix = normalizeWindowTitle(prefix).toLowerCase();
    return normalizedPrefix && lowerTitle.startsWith(normalizedPrefix);
  });
}

export function isBrowserWindow(win) {
  const executable = executableName(win);
  if (BROWSER_EXECUTABLES.has(executable)) return true;

  let title = "";
  try {
    title = String(win?.getTitle?.() || win?.title || "").trim();
  } catch {}
  return BROWSER_TITLE_SUFFIX.test(title);
}

export function isKnownNonTablePokerWindowTitle(title, options = {}) {
  const normalizedTitle = normalizeWindowTitle(title);
  if (!normalizedTitle) return true;

  if (titleStartsWithAny(normalizedTitle, options.prefixes)) {
    return true;
  }

  const keywords = [
    ...DEFAULT_NON_TABLE_TITLE_KEYWORDS,
    ...(Array.isArray(options.keywords) ? options.keywords : [])
  ];

  return keywords.some((keyword) => titleHasKeyword(normalizedTitle, keyword));
}

export function isKnownPokerClientWindow(win, options = {}) {
  const executable = executableName(win);
  if (POKER_EXECUTABLES.has(executable)) return true;

  const proc = processName(win);
  if (POKER_EXECUTABLES.has(proc)) return true;

  const cls = className(win);
  if (cls && POKER_CLASS_TOKENS.some((token) => cls.includes(token))) {
    return true;
  }

  const configuredClassIncludes = Array.isArray(options.classIncludes)
    ? options.classIncludes
    : [];
  if (cls && configuredClassIncludes.some((token) => cls.includes(String(token).toLowerCase()))) {
    return true;
  }

  return false;
}

export function isCoinPokerContainerWindow(win) {
  const executable = executableName(win);
  const proc = processName(win);
  if (executable !== "coinpoker.exe" && proc !== "coinpoker.exe") {
    return false;
  }

  const processPath = executablePath(win);
  if (!processPath.includes("\\unity-resources-win-x64\\coinpoker game\\coinpoker.exe")) {
    return false;
  }

  let title = "";
  try {
    title = normalizeWindowTitle(win?.getTitle?.() || win?.title || "");
  } catch {
    return false;
  }
  return title.toLowerCase() === "coinpoker";
}
