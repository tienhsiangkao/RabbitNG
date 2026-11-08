// RNG overlay logic — secure RNG, autosize, autoroll, optional IPC hooks.

// ---------- Secure RNG (bias-free) ----------
function secureIntInclusive(maxInclusive) {
  const max = Number(maxInclusive);
  if (!Number.isInteger(max) || max < 0 || max > 0xFFFFFFFF) {
    throw new RangeError("Expected an unsigned 32-bit integer maximum");
  }
  const range = max + 1;
  const limit = Math.floor(0x100000000 / range) * range;
  const buf = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    const x = buf[0] >>> 0;
    if (x < limit) return x % range;
  }
}

function secureIntBetween(min, max) {
  const a = min | 0;
  const b = max | 0;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo + secureIntInclusive(hi - lo);
}

// ---------- DOM ----------
const num = document.getElementById("num");
const hotspot = document.getElementById("hotspot");
const debugLog = (...args) => {
  if (window.rngDebug === true) {
    console.log(...args);
  }
};

// ---------- Animation state ----------
let currentValue = 0;
let latestRollId = 0;
let pendingDisplay = null;
let rollingTicker = null;
let rollingTimeout = null;

// ---------- UI helpers ----------
function renderDigits(value, applyStyle = true) {
  const v = Math.max(0, Math.min(99, value | 0));
  if (num.children.length !== 2) {
    num.innerHTML = '<span class="d">0</span><span class="d">0</span>';
  }
  const tens = Math.floor(v / 10);
  const ones = v % 10;
  num.children[0].textContent = String(tens);
  num.children[1].textContent = String(ones);

  if (applyStyle) {
    const hue = (v / 99) * 130;
    num.style.color = `hsl(${hue.toFixed(1)} 88% 62%)`;
  }
  return v;
}

function setNumber(n) {
  const v = renderDigits(n, true);
  currentValue = v;
  window.rng?.reportValue?.(v);

  try {
    num.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.06)" },
        { transform: "scale(1)" }
      ],
      { duration: 150, easing: "ease-out" }
    );
  } catch {}
}

function animateRollTo(target, rollId = null) {
  pendingDisplay = { value: target, rollId };
  // Coalesce rapid input into the current animation without postponing its
  // deadline forever. The latest authoritative target is always committed.
  if (rollingTimeout !== null) return;

  num.classList.add("rolling");
  const renderJitter = () => {
    let temporaryValue = secureIntBetween(0, 99);
    if (temporaryValue === currentValue || temporaryValue === pendingDisplay.value) {
      temporaryValue = (temporaryValue + 1) % 100;
    }
    renderDigits(temporaryValue, true);
  };

  renderJitter();
  rollingTicker = setInterval(renderJitter, 45);
  rollingTimeout = setTimeout(() => {
    const { value: finalValue, rollId: committedRollId } = pendingDisplay;
    pendingDisplay = null;
    clearInterval(rollingTicker);
    rollingTicker = null;
    rollingTimeout = null;
    num.classList.remove("rolling");
    renderDigits(finalValue, true);
    currentValue = finalValue;
    window.rng?.reportValue?.(finalValue, committedRollId);
  }, 420);
}

function autosize() {
  const card = document.querySelector(".card");
  if (!card) return;
  const w = card.clientWidth || 80;
  const h = card.clientHeight || 60;

  const tableWidth = window.tableSize?.width || 1000;
  const tableHeight = window.tableSize?.height || 700;

  debugLog(
    `[DEBUG] autosize called - Table size: ${tableWidth}x${tableHeight}, Overlay: ${w}x${h}`
  );
  debugLog(`[DEBUG] window.tableSize:`, window.tableSize);

  // The main process scales the overlay with the table; fit the digits inside
  // the resulting card so resizing never clips or leaves a fixed-size font.
  const fsFromOverlayHeight = Math.max(12, Math.floor(h * .92));
  const fsFromOverlayWidth = Math.max(12, Math.floor(w / 1.1));

  debugLog(
    `[DEBUG] Font calculations - Height: ${fsFromOverlayHeight}, Width: ${fsFromOverlayWidth}`
  );

  const fs = Math.min(fsFromOverlayHeight, fsFromOverlayWidth);

  debugLog(`[DEBUG] Final font size: ${fs}px`);
  num.style.fontSize = `${fs}px`;

  debugLog(
    `[font] Table: ${tableWidth}x${tableHeight}, Overlay: ${w}x${h}, Font: ${fs}px (from overlay: ${fsFromOverlayHeight}/${fsFromOverlayWidth})`
  );
}

function roll(reason = "manual") {
  if (window.rng?.requestRoll) {
    window.rng.requestRoll(reason);
  } else {
    animateRollTo(secureIntBetween(0, 99));
  }
}

// ---------- Click (on hotspot only) ----------
hotspot.addEventListener("click", () => {
  roll();
  if (AUTO_MS > 0) startAutoRoll();
});

hotspot.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  roll();
  if (AUTO_MS > 0) startAutoRoll(); // Reset timer only if interval mode is enabled
});

// ---------- IPC hooks (optional) ----------
if (window.rng?.onTableSize) {
  window.rng.onTableSize((tableSize) => {
    debugLog(`[DEBUG] Received table size via IPC:`, tableSize);
    window.tableSize = tableSize;
    autosize();
  });
} else {
  debugLog(`[DEBUG] window.rng.onTableSize not available, using fallback`);
}

// ---------- Resize observer ----------
new ResizeObserver(() => autosize()).observe(document.body);

// ---------- Auto-roll functionality ----------
let autoTimer = null;
let AUTO_MS = 0; // Disabled by default; main process can enable via IPC

function startAutoRoll() {
  stopAutoRoll();
  if (AUTO_MS > 0) {
    autoTimer = setInterval(() => roll("interval"), AUTO_MS);
    debugLog(`[autoroll] Started auto-roll every ${AUTO_MS}ms`);
  }
}

function stopAutoRoll() {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
    debugLog(`[autoroll] Stopped auto-roll`);
  }
}

if (window.rng?.onRollNow) {
  window.rng.onRollNow((target) => {
    debugLog(`[autoroll] Manual roll triggered via IPC`);
    if (!target || !Number.isInteger(target.value) || target.value < 0 || target.value > 99 ||
        !Number.isSafeInteger(target.rollId) || target.rollId <= latestRollId) return;
    latestRollId = target.rollId;
    animateRollTo(target.value, target.rollId);
    if (AUTO_MS > 0) startAutoRoll(); // Reset timer only if interval mode is enabled
  });
}

// Handle auto-roll interval updates
if (window.rng?.onSetAutoRollInterval) {
  window.rng.onSetAutoRollInterval((intervalMs) => {
    AUTO_MS = Number(intervalMs) || 0;
    if (AUTO_MS > 0) {
      debugLog(`[autoroll] Interval updated to ${AUTO_MS}ms`);
      startAutoRoll(); // Restart with new interval
    } else {
      debugLog(`[autoroll] Auto-roll disabled (interval <= 0)`);
      stopAutoRoll();
    }
  });
}

// ---------- Initial paint ----------
if (window.rng?.requestRoll) {
  renderDigits(0);
  roll("initial");
} else {
  setNumber(secureIntBetween(0, 99));
}
autosize();
startAutoRoll(); // Start auto-roll immediately

debugLog(`[DEBUG] window.rng available:`, !!window.rng);
debugLog(`[DEBUG] window.rng.onTableSize available:`, !!window.rng?.onTableSize);
