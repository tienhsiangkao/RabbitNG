// RNG overlay logic — secure RNG, autosize, autoroll, optional IPC hooks.

// ---------- Secure RNG (bias-free) ----------
function secureIntInclusive(maxInclusive) {
  const max = Number(maxInclusive) >>> 0;
  const range = (max + 1) >>> 0;
  const maxUint32 = 0xFFFFFFFF;
  const limit = (Math.floor((maxUint32 + 1) / range) * range - 1) >>> 0;
  const buf = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    const x = buf[0] >>> 0;
    if (x <= limit) return (x % range) >>> 0;
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

// ---------- Animation state ----------
let currentValue = 0;
let rollingTicker = null;
let rollingTimeout = null;
let isRolling = false;

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
    const t = v / 99;
    const hue = 0 + t * 130;
    num.style.color = `hsl(${hue.toFixed(1)} 88% 62%)`;
  }
  return v;
}

function setNumber(n) {
  const v = renderDigits(n, true);
  currentValue = v;

  if (isRolling) return;

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

function animateRollTo(target) {
  if (isRolling) {
    clearInterval(rollingTicker);
    clearTimeout(rollingTimeout);
    rollingTicker = null;
    rollingTimeout = null;
    num.classList.remove("rolling");
    isRolling = false;
    renderDigits(currentValue, true);
  }

  isRolling = true;
  num.classList.add("rolling");

  const jitter = () => {
    const temp = secureIntBetween(0, 99);
    renderDigits(temp, false);
  };

  jitter();
  rollingTicker = setInterval(jitter, 32);

  rollingTimeout = setTimeout(() => {
    clearInterval(rollingTicker);
    rollingTicker = null;
    isRolling = false;
    num.classList.remove("rolling");
    setNumber(target);
    rollingTimeout = null;
  }, 520);
}

function autosize() {
  const card = document.querySelector(".card");
  if (!card) return;
  const w = card.clientWidth || 80;
  const h = card.clientHeight || 60;

  const tableWidth = window.tableSize?.width || 1000;
  const tableHeight = window.tableSize?.height || 700;

  console.log(
    `[DEBUG] autosize called - Table size: ${tableWidth}x${tableHeight}, Overlay: ${w}x${h}`
  );
  console.log(`[DEBUG] window.tableSize:`, window.tableSize);

  // Base font size as percentage of table diagonal - very large adaptive scaling
  const tableDiagonal = Math.sqrt(tableWidth * tableWidth + tableHeight * tableHeight);
  const baseFontSize = tableDiagonal * 0.150; // 15% of table diagonal

  console.log(
    `[DEBUG] Table diagonal: ${tableDiagonal.toFixed(2)}, Base font size: ${baseFontSize.toFixed(
      2
    )}`
  );

  // Calculate font size from table size (primary) and overlay constraints (secondary)
  const fsFromTable = Math.max(28, Math.floor(baseFontSize));
  const fsFromOverlayHeight = Math.max(28, Math.floor(h * 1.0)); // Generous height constraint
  const fsFromOverlayWidth = Math.max(28, Math.floor(w / 0.8)); // Generous width constraint

  console.log(
    `[DEBUG] Font calculations - Table: ${fsFromTable}, Height: ${fsFromOverlayHeight}, Width: ${fsFromOverlayWidth}`
  );

  // Use table-based size as primary, but ensure it doesn't exceed overlay bounds
  const fs = Math.min(fsFromTable, fsFromOverlayHeight, fsFromOverlayWidth);

  console.log(`[DEBUG] Final font size: ${fs}px`);
  num.style.fontSize = `${fs}px`;

  console.log(
    `[font] Table: ${tableWidth}x${tableHeight}, Overlay: ${w}x${h}, Font: ${fs}px (from table: ${fsFromTable}, overlay: ${fsFromOverlayHeight}/${fsFromOverlayWidth})`
  );
}

function roll() {
  const target = secureIntBetween(0, 99);
  animateRollTo(target);
}

// ---------- Click (on hotspot only) ----------
let downPos = null;
let downAt = 0;
const DRAG_PX = 4;
const CLICK_MS = 350;

hotspot.addEventListener(
  "mousedown",
  (e) => {
    downPos = { x: e.screenX, y: e.screenY };
    downAt = performance.now();
  },
  { passive: true }
);

hotspot.addEventListener("mouseup", (e) => {
  if (e.button !== 0) return; // only treat left-click as click
  if (!downPos) return;
  const dx = Math.abs(e.screenX - downPos.x);
  const dy = Math.abs(e.screenY - downPos.y);
  const dt = performance.now() - downAt;
  downPos = null;
  const isClick = dx <= DRAG_PX && dy <= DRAG_PX && dt <= CLICK_MS;
  if (isClick) {
    roll();
    if (AUTO_MS > 0) startAutoRoll(); // Reset timer only if interval mode is enabled
  }
});

document.addEventListener("contextmenu", (e) => {
  // Right-click anywhere on the overlay triggers a roll
  e.preventDefault();
  roll();
  if (AUTO_MS > 0) startAutoRoll(); // Reset timer only if interval mode is enabled
}, { capture: true });

// ---------- IPC hooks (optional) ----------
if (window.rng?.onTableSize) {
  window.rng.onTableSize((tableSize) => {
    console.log(`[DEBUG] Received table size via IPC:`, tableSize);
    window.tableSize = tableSize;
    autosize();
  });
} else {
  console.log(`[DEBUG] window.rng.onTableSize not available, using fallback`);
}

// ---------- Resize observer ----------
new ResizeObserver(() => autosize()).observe(document.body);

// ---------- Auto-roll functionality ----------
let autoTimer = null;
let AUTO_MS = 0; // Disabled by default; main process can enable via IPC

function startAutoRoll() {
  stopAutoRoll();
  if (AUTO_MS > 0) {
    autoTimer = setInterval(roll, AUTO_MS);
    console.log(`[autoroll] Started auto-roll every ${AUTO_MS}ms`);
  }
}

function stopAutoRoll() {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
    console.log(`[autoroll] Stopped auto-roll`);
  }
}

if (window.rng?.onRollNow) {
  window.rng.onRollNow(() => {
    console.log(`[autoroll] Manual roll triggered via IPC`);
    roll();
    if (AUTO_MS > 0) startAutoRoll(); // Reset timer only if interval mode is enabled
  });
}

// Handle auto-roll interval updates
if (window.rng?.onSetAutoRollInterval) {
  window.rng.onSetAutoRollInterval((intervalMs) => {
    AUTO_MS = Number(intervalMs) || 0;
    if (AUTO_MS > 0) {
      console.log(`[autoroll] Interval updated to ${AUTO_MS}ms`);
      startAutoRoll(); // Restart with new interval
    } else {
      console.log(`[autoroll] Auto-roll disabled (interval <= 0)`);
      stopAutoRoll();
    }
  });
}

// ---------- Initial paint ----------
setNumber(secureIntBetween(0, 99)); // start randomized
autosize();
startAutoRoll(); // Start auto-roll immediately

console.log(`[DEBUG] window.rng available:`, !!window.rng);
console.log(`[DEBUG] window.rng.onTableSize available:`, !!window.rng?.onTableSize);
