const refs = {
  quietMode: document.getElementById("quietMode"),
  autoStart: document.getElementById("autoStart"),
  activeOnly: document.getElementById("activeOnly"),
  turnRecognition: document.getElementById("turnRecognition"),
  stakesOverlay: document.getElementById("stakesOverlay"),
  clockOverlay: document.getElementById("clockOverlay"),
  scanMs: document.getElementById("scanMs"),
  scanValue: document.getElementById("scanValue"),
  autoRollRange: document.getElementById("autoRollRange"),
  autoRollLabel: document.getElementById("autoRollLabel"),
  closeBtn: document.getElementById("closeBtn")
};

const state = {
  quietMode: true,
  autoStartEnabled: true,
  showOnlyActiveTables: false,
  showStakesOverlay: true,
  showClockOverlay: true,
  turnRecognitionEnabled: false,
  scanMs: 300,
  autoRollSeconds: 0
};

const appSettings = window.appSettings;

function render(next = {}) {
  Object.assign(state, next);
  refs.quietMode.checked = !!state.quietMode;
  refs.autoStart.checked = !!state.autoStartEnabled;
  refs.activeOnly.checked = !!state.showOnlyActiveTables;
  refs.stakesOverlay.checked = !!state.showStakesOverlay;
  refs.clockOverlay.checked = !!state.showClockOverlay;
  refs.turnRecognition.checked = !!state.turnRecognitionEnabled;
  refs.scanMs.value = state.scanMs;
  refs.scanValue.textContent = `${state.scanMs} ms`;
  refs.autoRollRange.value = state.autoRollSeconds ?? 0;
  refs.autoRollLabel.textContent =
    state.autoRollSeconds > 0 ? `${state.autoRollSeconds}s` : "Turn-based";
}

function sendPatch(patch) {
  if (!appSettings?.update) return;
  appSettings
    .update(patch)
    .then(render)
    .catch((err) => console.error("[settings] Failed to update:", err));
}

function initListeners() {
  refs.quietMode.addEventListener("change", (e) =>
    sendPatch({ quietMode: e.target.checked })
  );
  refs.autoStart.addEventListener("change", (e) =>
    sendPatch({ autoStartEnabled: e.target.checked })
  );
  refs.activeOnly.addEventListener("change", (e) =>
    sendPatch({ showOnlyActiveTables: e.target.checked })
  );
  refs.stakesOverlay.addEventListener("change", (e) =>
    sendPatch({ showStakesOverlay: e.target.checked })
  );
  refs.clockOverlay.addEventListener("change", (e) =>
    sendPatch({ showClockOverlay: e.target.checked })
  );
  refs.turnRecognition.addEventListener("change", (e) =>
    sendPatch({ turnRecognitionEnabled: e.target.checked })
  );

  let scanDebounce = null;
  refs.scanMs.addEventListener("input", (e) => {
    const value = Math.max(120, Math.min(2000, Number(e.target.value) || 300));
    refs.scanValue.textContent = `${value} ms`;
  });
  refs.scanMs.addEventListener("change", (e) => {
    const value = Math.max(120, Math.min(2000, Number(e.target.value) || 300));
    clearTimeout(scanDebounce);
    scanDebounce = setTimeout(() => sendPatch({ scanMs: value }), 150);
  });

  refs.autoRollRange.addEventListener("input", (e) => {
    const value = Number(e.target.value) || 0;
    refs.autoRollLabel.textContent = value > 0 ? `${value}s` : "Turn-based";
  });
  refs.autoRollRange.addEventListener("change", (e) => {
    const value = Math.max(0, Math.min(60, Number(e.target.value) || 0));
    sendPatch({ autoRollSeconds: value });
  });

  refs.closeBtn.addEventListener("click", () => window.close());
}

async function init() {
  if (!appSettings?.get) return;
  const payload = await appSettings.get();
  render(payload);
  initListeners();
  appSettings.onChange?.(render);
}

init().catch((err) => console.error("[settings] init failed:", err));
