// // // Transparent overlay: fixed-width 2-slot number (0..99). Click to roll; auto-roll every 10s.
// // // Font size follows TABLE size if main.js sends table-size IPC.

// // const elNum   = document.getElementById("num");
// // const elClick = document.getElementById("clickArea");

// // let autoTimer = null;
// // const AUTO_MS = 10000;
// // const MAX = 99;  // <=— 0..99

// // let lastTable = { width: 0, height: 0 };

// // // color map 0..max => red->green
// // function valueToColor(value, max) {
// //   const r = Math.max(0, Math.min(1, value / Math.max(1, max)));
// //   const hue = 120 * r; // 0 red -> 120 green
// //   return `hsl(${hue}, 90%, 55%)`;
// // }
// // function rollValue(max) {
// //   try { return crypto.getRandomValues(new Uint32Array(1))[0] % (max + 1); }
// //   catch { return Math.floor(Math.random() * (max + 1)); }
// // }

// // // Render into exactly 2 slots: [tens][ones]
// // // Leading zero in tens is hidden via opacity but space is reserved (constant width).
// // function renderFixedSlots(n) {
// //   const v = Math.max(0, Math.min(MAX, Math.floor(n)));
// //   const tens = Math.floor(v / 10);
// //   const ones = v % 10;

// //   // ensure 2 span children exist
// //   while (elNum.children.length < 2) {
// //     const span = document.createElement("span");
// //     span.className = "d";
// //     elNum.appendChild(span);
// //   }

// //   const [sT, sO] = elNum.children;
// //   sT.textContent = String(tens);
// //   sO.textContent = String(ones);

// //   // hide tens if <10, keep width
// //   sT.style.opacity = v < 10 ? "0" : "1";
// //   sO.style.opacity = "1";
// // }

// // function animateTo(value) {
// //   elNum.style.color = valueToColor(value, MAX);
// //   try {
// //     elNum.animate(
// //       [{transform:"scale(1)"},{transform:"scale(1.08)"},{transform:"scale(1)"}],
// //       {duration:120, easing:"ease-out"}
// //     );
// //   } catch {}
// //   renderFixedSlots(value);
// // }

// // async function doRoll() {
// //   animateTo(rollValue(MAX));
// //   scheduleAuto();
// // }

// // function scheduleAuto() {
// //   if (autoTimer) clearInterval(autoTimer);
// //   autoTimer = setInterval(() => { void doRoll(); }, AUTO_MS);
// // }

// // // --- FONT SIZE from TABLE SIZE (falls back gracefully) ---
// // function applyFontFromTable() {
// //   const { width, height } = lastTable;
// //   const base = (width && height) ? Math.min(width, height) :
// //                Math.min((elClick || document.body).clientWidth || 200,
// //                         (elClick || document.body).clientHeight || 120);
// //   const size = Math.max(20, Math.floor(base * 0.1)); // tweak factor to taste
// //   elNum.style.fontSize = size + "px";
// // }

// // // IPC from main.js: table size
// // if (window.rng?.onTableSize) {
// //   window.rng.onTableSize((data) => {
// //     lastTable = { width: Number(data?.width) || 0, height: Number(data?.height) || 0 };
// //     applyFontFromTable();
// //   });
// // }

// // // Also adjust on overlay resize (fallback)
// // window.addEventListener("resize", applyFontFromTable);

// // // clicks: left or right
// // elClick.addEventListener("click", () => { void doRoll(); });
// // elClick.addEventListener("contextmenu", (e) => { e.preventDefault(); void doRoll(); });

// // // init
// // window.addEventListener("load", async () => {
// //   applyFontFromTable();
// //   renderFixedSlots(0); // initial
// //   await doRoll();
// //   scheduleAuto();
// // });
// // renderer.js (ES module, secure RNG + autosize + gradient + optional IPC hooks)

// // renderer.js (ES module, secure RNG + autosize + gradient + optional IPC hooks)

// // renderer.js — secure RNG + autosize + gradient + auto-roll (IPC + fallback)

// // --- Secure RNG (no modulo bias) ---
// function secureIntInclusive(maxInclusive) {
//   const max = Number(maxInclusive) >>> 0;           // uint32
//   const range = max + 1;
//   const maxUint32 = 0xFFFFFFFF;
//   const limit = Math.floor((maxUint32 + 1) / range) * range - 1;
//   const buf = new Uint32Array(1);
//   while (true) {
//     crypto.getRandomValues(buf);
//     const x = buf[0];
//     if (x <= limit) return x % range;
//   }
// }
// function secureIntBetween(min, max) {
//   const a = (min | 0), b = (max | 0);
//   const lo = Math.min(a, b), hi = Math.max(a, b);
//   return lo + secureIntInclusive(hi - lo);
// }

// // --- DOM refs ---
// const num = document.getElementById("num");
// const clickArea = document.getElementById("clickArea");

// // --- State ---
// let lastValue = 0;                    // 0..99
// let tableSize = { width: 1000, height: 700 }; // default until IPC arrives

// // --- UI helpers ---
// function setNumber(n) {
//   const v = Math.max(0, Math.min(99, n | 0));
//   lastValue = v;

//   // ensure two digit slots exist
//   if (num.children.length !== 2) {
//     num.innerHTML = '<span class="d">0</span><span class="d">0</span>';
//   }
//   const tens = Math.floor(v / 10);
//   const ones = v % 10;
//   num.children[0].textContent = tens.toString();
//   num.children[1].textContent = ones.toString();

//   // smooth red → green
//   const t = v / 99;
//   const hue = 0 + t * 130;   // 0..130
//   num.style.color = `hsl(${hue.toFixed(1)} 88% 62%)`;
// }

// function autosize() {
//   const card = document.querySelector(".card");
//   if (!card) return;
//   const w = card.clientWidth;
//   const h = card.clientHeight;
//   const fsFromHeight = Math.max(10, Math.floor(h * 0.7));
//   const fsFromWidth  = Math.max(10, Math.floor(w / 1.35)); // “88” width guard
//   num.style.fontSize = `${Math.min(fsFromHeight, fsFromWidth)}px`;
// }

// function roll() {
//   const n = secureIntBetween(0, 99);
//   setNumber(n);
// }

// // --- Auto-roll (IPC + fallback timer) ---
// let localAutoTimer = null;
// const LOCAL_AUTO_MS = 10000;
// let remoteAutoDetected = false;

// function startLocalAuto() {
//   stopLocalAuto();
//   localAutoTimer = setInterval(roll, LOCAL_AUTO_MS);
// }
// function stopLocalAuto() {
//   if (localAutoTimer) { clearInterval(localAutoTimer); localAutoTimer = null; }
// }

// // If main sends roll-now, use that and disable local timer to avoid double rolling
// if (window.rng?.onRollNow) {
//   window.rng.onRollNow(() => {
//     remoteAutoDetected = true;
//     if (localAutoTimer) stopLocalAuto();
//     roll();
//   });
// }

// // Start local auto; if IPC is present, first roll-now will turn this off
// startLocalAuto();

// // --- Events ---
// // Left-click → roll (also resets local timer so next auto-roll happens in full interval)
// if (clickArea) {
//   clickArea.addEventListener("click", (e) => {
//     if (e.altKey) return; // Alt is used for click-through toggle in some builds
//     roll();
//     if (!remoteAutoDetected) { startLocalAuto(); }
//   });
// }

// // Alt+wheel opacity (optional; requires preload exposing rng.adjustOpacity)
// window.addEventListener("wheel", (e) => {
//   if (e.altKey && window.rng?.adjustOpacity) {
//     e.preventDefault();
//     window.rng.adjustOpacity(e.deltaY);
//   }
// }, { passive: false });

// // Alt+mousedown toggles click-through (optional)
// window.addEventListener("mousedown", (e) => {
//   if (e.altKey && window.rng?.toggleClickThrough) {
//     e.preventDefault();
//     window.rng.toggleClickThrough();
//   }
// });

// // Shift+drag -> save position (optional)
// let dragging = false;
// window.addEventListener("mousedown", (e) => {
//   if (e.shiftKey) {
//     dragging = true;
//     document.documentElement.classList.add("force-drag");
//   }
// });
// function endDrag() {
//   if (!dragging) return;
//   dragging = false;
//   document.documentElement.classList.remove("force-drag");
//   window.rng?.dragEnded?.();
// }
// window.addEventListener("mouseup", endDrag);
// window.addEventListener("mouseleave", endDrag);

// // IPC: table size (optional)
// if (window.rng?.onTableSize) {
//   window.rng.onTableSize((sz) => {
//     if (sz && typeof sz.width === "number" && typeof sz.height === "number") {
//       tableSize = sz;
//       autosize();
//     }
//   });
// }

// // Resize observer to autoresize when window changes
// new ResizeObserver(() => autosize()).observe(document.body);

// // Initial paint
// autosize();
// roll();
// renderer.js — secure RNG, autosize, gradient color, Shift-drag cover, IPC hooks
// renderer.js — clean drag with -webkit-app-region, secure RNG, autosize, gradient color

// renderer.js — native drag via app-region, big centered click hotspot, bias-free RNG, autosize

// renderer.js

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
  const a = min | 0, b = max | 0;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return lo + secureIntInclusive(hi - lo);
}

// ---------- DOM ----------
const num     = document.getElementById("num");
const hotspot = document.getElementById("hotspot");

// ---------- UI helpers ----------
function setNumber(n) {
  const v = Math.max(0, Math.min(99, n | 0));

  if (num.children.length !== 2) {
    num.innerHTML = '<span class="d">0</span><span class="d">0</span>';
  }
  const tens = Math.floor(v / 10);
  const ones = v % 10;
  num.children[0].textContent = String(tens);
  num.children[1].textContent = String(ones);

  // smooth red -> green-ish gradient
  const t = v / 99;                 // 0..1
  const hue = 0 + t * 130;          // red -> green-ish
  num.style.color = `hsl(${hue.toFixed(1)} 88% 62%)`;

  // tiny pop animation
  try {
    num.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }],
      { duration: 120, easing: "ease-out" }
    );
  } catch {}
}

function autosize() {
  const card = document.querySelector(".card");
  if (!card) return;
  const w = card.clientWidth  || 120;
  const h = card.clientHeight || 90;

  const fsFromHeight = Math.max(10, Math.floor(h * 0.70));
  const fsFromWidth  = Math.max(10, Math.floor(w / 1.35));  // “88” width approx
  const fs = Math.min(fsFromHeight, fsFromWidth);

  num.style.fontSize = `${fs}px`;
}

function roll() {
  setNumber(secureIntBetween(0, 99));
}

// ---------- Click (on hotspot only) ----------
let downPos = null;
let downAt  = 0;
const DRAG_PX  = 4;
const CLICK_MS = 350;

hotspot.addEventListener("mousedown", (e) => {
  downPos = { x: e.screenX, y: e.screenY };
  downAt  = performance.now();
}, { passive: true });

hotspot.addEventListener("mouseup", (e) => {
  if (!downPos) return;
  const dx = Math.abs(e.screenX - downPos.x);
  const dy = Math.abs(e.screenY - downPos.y);
  const dt = performance.now() - downAt;
  downPos = null;
  const isClick = dx <= DRAG_PX && dy <= DRAG_PX && dt <= CLICK_MS;
  if (isClick) roll();
});

hotspot.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  roll();
});

// ---------- IPC hooks (optional) ----------
if (window.rng?.onTableSize) {
  window.rng.onTableSize(() => autosize());
}
if (window.rng?.onRollNow) {
  window.rng.onRollNow(() => roll());
}

// ---------- Resize observer ----------
new ResizeObserver(() => autosize()).observe(document.body);

// ---------- Initial paint ----------
setNumber(secureIntBetween(0, 99));  // start randomized
autosize();
