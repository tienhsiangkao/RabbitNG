import { normalizeAppearance, patchAppearance } from './src/appearance-settings.js';
import { normalizeComfort } from './src/session-comfort.js';
import {normalizeSessionFocus} from './src/session-focus-model.js';
const refs = {
  quietMode: document.getElementById("quietMode"),
  autoStart: document.getElementById("autoStart"),
  activeOnly: document.getElementById("activeOnly"),
  buyInOverlay: document.getElementById("buyInOverlay"),
  clockOverlay: document.getElementById("clockOverlay"),
  stakeFrame: document.getElementById("stakeFrame"),
  scanMs: document.getElementById("scanMs"),
  scanValue: document.getElementById("scanValue"),
  autoRollRange: document.getElementById("autoRollRange"),
  autoRollLabel: document.getElementById("autoRollLabel"),
  layoutEnabled: document.getElementById("layoutEnabled"),
  layoutAutoArrange: document.getElementById("layoutAutoArrange"),
  layoutLock: document.getElementById("layoutLock"),
  layoutStartup: document.getElementById("layoutStartup"),
  layoutRestore: document.getElementById("layoutRestore"),
  layoutControls: document.getElementById("layoutControls"),
  layoutProfile: document.getElementById("layoutProfile"),
  layoutProfileName: document.getElementById("layoutProfileName"),
  newProfileName: document.getElementById("newProfileName"),
  addProfileBtn: document.getElementById("addProfileBtn"),
  deleteProfileBtn: document.getElementById("deleteProfileBtn"),
  layoutMonitor: document.getElementById("layoutMonitor"),
  layoutRows: document.getElementById("layoutRows"),
  layoutColumns: document.getElementById("layoutColumns"),
  layoutGap: document.getElementById("layoutGap"),
  layoutMargin: document.getElementById("layoutMargin"),
  applyLayoutBtn: document.getElementById("applyLayoutBtn"),
  closeBtn: document.getElementById("closeBtn")
};

const state = {
  quietMode: true,
  autoStartEnabled: true,
  showOnlyActiveTables: false,
  showBuyInOverlay: true,
  showClockOverlay: true,
  showStakeFrame: true,
  scanMs: 300,
  autoRollSeconds: 3,
  displays: [],
  tableLayout: {
    enabled: true,
    autoArrange: true,
    lockLayout: false,
    activeProfileId: "default",
    profiles: []
  }
};

const appSettings = window.appSettings;
let appearanceDraft=null, appearanceRevision=0, appearanceDebounce=null;
const focusDirtyRows=new Set(),focusRowVersions=[0,0,0,0,0];
const byId=id=>document.getElementById(id);
function ensureFocusEditor(focus){
  focus.lines.forEach((_,i)=>{
    let input=byId('sessionFocus'+(i+1));
    if(!input){const row=document.createElement('div');row.className='field';const label=document.createElement('label');label.htmlFor='sessionFocus'+(i+1);label.textContent=String(i+1);input=document.createElement('textarea');input.id=label.htmlFor;input.rows=3;row.append(label,input);byId('sessionFocusEditor').append(row);}
    if(input.dataset.bound)return;input.dataset.bound='1';
    const update=event=>{if(event?.isComposing)return;const limit=state.sessionFocus?.drills?2400:160;input.value=Array.from(input.value).slice(0,limit).join('');focusDirtyRows.add(i);focusRowVersions[i]=(focusRowVersions[i]||0)+1;byId('sessionFocusSaveState').textContent='Not saved yet.';};
    input.addEventListener('input',update);input.addEventListener('compositionend',update);
  });
}
const appearanceFields={frameThickness:1,frameOpacity:100,rngScale:100,rngGap:100};
function renderComfort() {
  const a=appearanceDraft || normalizeAppearance(state.appearance), c=normalizeComfort(state.comfort);
  for(const [key,multiplier] of Object.entries(appearanceFields)) {
    byId(key).value=a[key]*multiplier;
    byId(key+'Value').textContent=key==='frameThickness'?`${a[key]}×`:key==='rngGap'?`${(a[key]*100).toFixed(1)}%`:`${Math.round(a[key]*100)}%`;
  }
  const preview=byId('appearancePreview'),rng=byId('previewRng');
  preview.style.borderWidth=`${a.frameThickness*2}px`;
  preview.style.borderColor=`rgba(196,181,253,${a.frameOpacity})`;
  rng.style.right=`${(1-.43+a.rngGap)*100}%`;rng.style.fontSize=`${23*a.rngScale}px`;
  byId('clockMode').value=c.clockMode;byId('breakEnabled').checked=c.breakEnabled;
  byId('breakMinutes').value=c.breakMinutes;byId('breakMinutes').disabled=!c.breakEnabled;
  byId('workspaceEnabled').checked=state.workspace?.enabled!==false;
  const focus=normalizeSessionFocus(state.sessionFocus);byId('sessionFocusEnabled').checked=focus.enabled;
  ensureFocusEditor(focus);
  focus.lines.forEach((line,i)=>{if(!focusDirtyRows.has(i))byId('sessionFocus'+(i+1)).value=focus.drills?.[i]?.detail??line;});
  byId('workspaceStatus').textContent=state.workspace?.message||'';
  byId('sessionPlaying').textContent=state.session?.playing?'Pause playing / restore windows':'Start playing / minimize distractions';
  byId('sessionState').textContent=state.session?.focusError || (state.session?.breakActive?'10-minute break running':state.session?.breakReady?'Break finished — resume when ready':state.session?.playing?'Playing':'Paused');
  byId('completeBreak').disabled=state.session?.breakActive===true||state.session?.breakReady===true;
  byId('snoozeBreak').disabled=state.session?.breakActive===true||state.session?.breakReady===true;
}
function changeAppearance(patch,immediate=false) {
  clearTimeout(appearanceDebounce);
  appearanceDraft=patchAppearance(appearanceDraft||state.appearance,patch);
  const revision=++appearanceRevision;
  const outgoing={...appearanceDraft,...patch};delete outgoing.presets;
  renderComfort();
  const save=()=>sendPatch({appearance:outgoing}).then(saved=> {
    if(saved===false){byId('appearanceStatus').textContent='Unable to save appearance. Please try again.';return;}
    if(revision===appearanceRevision) {appearanceDraft=null;renderComfort();byId('appearanceStatus').textContent=patch.savePreset?'Preset saved.':patch.loadPreset?'Preset applied.':patch.reset?'Appearance reset.':'Appearance saved.';}
  }).catch(()=>{byId('appearanceStatus').textContent='Unable to save appearance. Please try again.';});
  if(immediate) void save();else appearanceDebounce=setTimeout(save,90);
}

function activeLayoutProfile() {
  return state.tableLayout?.profiles?.find(
    (profile) => profile.id === state.tableLayout.activeProfileId
  ) || state.tableLayout?.profiles?.[0] || null;
}

function replaceOptions(select, options, selectedValue) {
  select.replaceChildren();
  for (const optionData of options) {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    select.append(option);
  }
  if (selectedValue != null) select.value = String(selectedValue);
}

function renderTableLayout() {
  const config = state.tableLayout || {};
  const profiles = Array.isArray(config.profiles) ? config.profiles : [];
  const profile = activeLayoutProfile();
  refs.layoutEnabled.checked = config.enabled === true;
  refs.layoutAutoArrange.checked = config.autoArrange !== false;
  refs.layoutLock.checked = config.lockLayout === true;
  refs.layoutStartup.checked = config.arrangeOnStartup === true;
  refs.layoutRestore.checked = config.restoreOnStop === true;
  refs.layoutControls.setAttribute("aria-disabled", config.enabled === true ? "false" : "true");

  replaceOptions(
    refs.layoutProfile,
    profiles.map((item) => ({ value: item.id, label: item.name })),
    config.activeProfileId
  );
  refs.deleteProfileBtn.disabled = profiles.length <= 1;

  if (!profile) return;
  refs.layoutProfileName.value = profile.name;
  const displays = Array.isArray(state.displays) ? [...state.displays] : [];
  if (!displays.some((display) => display.id === profile.monitorId)) {
    displays.push({
      id: profile.monitorId,
      label: `${profile.monitorId} (unavailable; choose a connected monitor)`
    });
  }
  replaceOptions(
    refs.layoutMonitor,
    displays.map((display) => ({ value: display.id, label: display.label })),
    profile.monitorId
  );
  refs.layoutRows.value = profile.rows;
  refs.layoutColumns.value = profile.columns;
  refs.layoutGap.value = profile.gap;
  refs.layoutMargin.value = profile.margin;
}

function render(next = {}) {
  if(next.sessionFocus&&state.sessionFocus&&next.sessionFocus.revision<state.sessionFocus.revision)next={...next,sessionFocus:state.sessionFocus};
  Object.assign(state, next);
  refs.quietMode.checked = !!state.quietMode;
  refs.autoStart.checked = !!state.autoStartEnabled;
  refs.activeOnly.checked = !!state.showOnlyActiveTables;
  refs.buyInOverlay.checked = !!state.showBuyInOverlay;
  refs.clockOverlay.checked = !!state.showClockOverlay;
  refs.stakeFrame.checked = state.showStakeFrame !== false;
  refs.scanMs.value = state.scanMs;
  refs.scanValue.textContent = `${state.scanMs} ms`;
  refs.autoRollRange.value = state.autoRollSeconds ?? 0;
  refs.autoRollLabel.textContent =
    state.autoRollSeconds > 0 ? `${state.autoRollSeconds}s` : "3s";
  renderTableLayout();
  renderComfort();
}

let updateChain = Promise.resolve();
function sendPatch(patch) {
  if (!appSettings?.update) return Promise.resolve();
  updateChain = updateChain
    .then(() => appSettings.update(patch))
    .then(payload=>{render(payload);return true;})
    .catch((err) => {console.error("[settings] Failed to update:", err);return false;});
  return updateChain;
}

function sendLayoutPatch(tableLayout) {
  sendPatch({ tableLayout });
}

function updateActiveProfile(profilePatch) {
  const profile = activeLayoutProfile();
  if (!profile) return;
  sendLayoutPatch({
    profile: {
      id: profile.id,
      ...profilePatch
    }
  });
}

function initListeners() {
  byId('sessionFocusEnabled').addEventListener('change',e=>sendPatch({sessionFocus:{enabled:e.target.checked}}));
  ensureFocusEditor(normalizeSessionFocus(state.sessionFocus));
  byId('saveSessionFocus').addEventListener('click',async()=>{
    const lineEdits={},submitted={};for(const i of focusDirtyRows){lineEdits[i]=byId('sessionFocus'+(i+1)).value;submitted[i]=focusRowVersions[i];}
    const saved=await sendPatch({sessionFocus:{lineEdits}});
    if(saved){for(const [i,version]of Object.entries(submitted))if(focusRowVersions[i]===version)focusDirtyRows.delete(Number(i));renderComfort();}
    byId('sessionFocusSaveState').textContent=saved?(focusDirtyRows.size?'New edits not saved.':'Saved locally.'):'Couldn’t save. Your edits are still here.';
  });
  byId('sessionPlaying').addEventListener('click',()=>sendPatch({playing:!state.session?.playing}));
  for(const [key,multiplier] of Object.entries(appearanceFields)) byId(key).addEventListener('input',e=>changeAppearance({[key]:Number(e.target.value)/multiplier}));
  for(const [id,patch] of Object.entries({loadFour:{loadPreset:'four'},saveFour:{savePreset:'four'},loadSix:{loadPreset:'six'},saveSix:{savePreset:'six'},resetAppearance:{reset:true}})) byId(id).addEventListener('click',()=>changeAppearance(patch,true));
  byId('clockMode').addEventListener('change',e=>sendPatch({comfort:{clockMode:e.target.value}}));
  byId('workspaceEnabled').addEventListener('change',e=>sendPatch({workspaceEnabled:e.target.checked}));
  byId('breakEnabled').addEventListener('change',e=>sendPatch({comfort:{breakEnabled:e.target.checked}}));
  byId('breakMinutes').addEventListener('change',e=>sendPatch({comfort:{breakMinutes:Number(e.target.value)}}));
  byId('snoozeBreak').addEventListener('click',()=>sendPatch({breakAction:'snooze'}));
  byId('completeBreak').addEventListener('click',()=>sendPatch({breakAction:'start-break'}));
  refs.quietMode.addEventListener("change", (e) =>
    sendPatch({ quietMode: e.target.checked })
  );
  refs.autoStart.addEventListener("change", (e) =>
    sendPatch({ autoStartEnabled: e.target.checked })
  );
  refs.activeOnly.addEventListener("change", (e) =>
    sendPatch({ showOnlyActiveTables: e.target.checked })
  );
  refs.buyInOverlay.addEventListener("change", (e) =>
    sendPatch({ showBuyInOverlay: e.target.checked })
  );
  refs.clockOverlay.addEventListener("change", (e) =>
    sendPatch({ showClockOverlay: e.target.checked })
  );
  refs.stakeFrame.addEventListener('change',e => sendPatch({showStakeFrame:e.target.checked}));
  refs.layoutEnabled.addEventListener("change", (e) =>
    sendLayoutPatch({ enabled: e.target.checked })
  );
  refs.layoutAutoArrange.addEventListener("change", (e) =>
    sendLayoutPatch({ autoArrange: e.target.checked })
  );
  refs.layoutLock.addEventListener("change", (e) =>
    sendLayoutPatch({ lockLayout: e.target.checked })
  );
  refs.layoutStartup.addEventListener("change", (e) =>
    sendLayoutPatch({ arrangeOnStartup: e.target.checked })
  );
  refs.layoutRestore.addEventListener("change", (e) =>
    sendLayoutPatch({ restoreOnStop: e.target.checked })
  );
  refs.layoutProfile.addEventListener("change", (e) =>
    sendLayoutPatch({ activeProfileId: e.target.value })
  );
  refs.layoutProfileName.addEventListener("change", (e) =>
    updateActiveProfile({ name: e.target.value })
  );
  refs.addProfileBtn.addEventListener("click", () => {
    const fallbackName = `Layout ${(state.tableLayout?.profiles?.length || 0) + 1}`;
    const name = refs.newProfileName.value.trim() || fallbackName;
    refs.newProfileName.value = "";
    sendLayoutPatch({ createProfileName: name });
  });
  refs.newProfileName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") refs.addProfileBtn.click();
  });
  refs.deleteProfileBtn.addEventListener("click", () => {
    const profile = activeLayoutProfile();
    if (!profile || state.tableLayout.profiles.length <= 1) return;
    if (!window.confirm(`Delete layout profile "${profile.name}"?`)) return;
    sendLayoutPatch({ deleteProfileId: profile.id });
  });
  refs.layoutMonitor.addEventListener("change", (e) =>
    updateActiveProfile({ monitorId: e.target.value })
  );

  const numericProfileFields = [
    [refs.layoutRows, "rows", 0, 12],
    [refs.layoutColumns, "columns", 0, 12],
    [refs.layoutGap, "gap", 0, 96],
    [refs.layoutMargin, "margin", 0, 160]
  ];
  for (const [element, field, min, max] of numericProfileFields) {
    element.addEventListener("change", (event) => {
      const value = Math.max(min, Math.min(max, Number(event.target.value) || 0));
      updateActiveProfile({ [field]: value });
    });
  }
  refs.applyLayoutBtn.addEventListener("click", () =>
    sendLayoutPatch({ applyNow: true })
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
    refs.autoRollLabel.textContent = value > 0 ? `${value}s` : "3s";
  });
  refs.autoRollRange.addEventListener("change", (e) => {
    const value = Math.max(1, Math.min(60, Number(e.target.value) || 3));
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
