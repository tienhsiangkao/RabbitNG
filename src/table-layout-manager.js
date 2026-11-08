import {
  boundsApproximatelyEqual,
  calculateTileRects,
  getActiveLayoutProfile,
  normalizeTableLayoutSettings
} from "./table-layout.js";
import { stakeBadgeForTitle } from './table-stakes.js';
import {physicalToNativeBounds,nativeReadbackBounds} from './native-window-bounds.js';
function stakeLevel(win) {try{return stakeBadgeForTitle(win.getTitle?.()||win.title||'')?.level||0;}catch{return 0;}}

function monitorDescriptors(windowManager, reportError) {
  let monitors = [];
  try {
    monitors = windowManager.getMonitors?.() || [];
  } catch (error) {
    reportError("Failed to enumerate monitors", error);
  }

  const valid = monitors.filter((monitor) => {
    try {
      return monitor?.isValid?.() !== false;
    } catch {
      return false;
    }
  });

  valid.sort((a, b) => {
    const aPrimary = a.isPrimary?.() === true;
    const bPrimary = b.isPrimary?.() === true;
    if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;
    const aBounds = a.getBounds?.() || {};
    const bBounds = b.getBounds?.() || {};
    return (Number(aBounds.x) || 0) - (Number(bBounds.x) || 0) ||
      (Number(aBounds.y) || 0) - (Number(bBounds.y) || 0);
  });

  return valid.map((monitor, index) => {
    const primary = monitor.isPrimary?.() === true;
    const bounds = monitor.getBounds();
    const workArea = monitor.getWorkArea();
    return {
      id: primary ? "primary" : `monitor:${String(monitor.id)}`,
      label: `Monitor ${index + 1}${primary ? " (Primary)" : ""} - ${workArea.width}x${workArea.height}`,
      primary,
      bounds: { ...bounds },
      workArea: { ...workArea },
      scaleFactor: Number(monitor.getScaleFactor?.()) || 1,
      monitor
    };
  });
}

function resolveMonitor(monitors, profile) {
  return monitors.find((monitor) => monitor.id === profile?.monitorId)
    || null;
}

function windowScale(win) {
  const factor = win.getMonitor?.()?.getScaleFactor?.() ?? 1;
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('Invalid window scale factor');
  return factor;
}

function physicalBounds(win) {
  const bounds = win.getBounds(), factor = windowScale(win);
  return Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, bounds[key] * factor]));
}

function setPhysicalBounds(win, bounds) {
  // node-window-manager multiplies all requested bounds by the window's
  // CURRENT monitor scale; undo that even when moving to a different monitor.
  const factor = windowScale(win);
  win.setBounds(physicalToNativeBounds(bounds,factor));
}

function validTargets(targets,count,area) {
  if(!area||!Array.isArray(targets)||targets.length!==count)return false;
  for(let i=0;i<targets.length;i++){
    const r=targets[i];
    if(!r||!['x','y','width','height'].every(k=>Number.isFinite(r[k]))||r.width<=0||r.height<=0||
      r.x<area.x||r.y<area.y||r.x+r.width>area.x+area.width||r.y+r.height>area.y+area.height)return false;
    for(let j=0;j<i;j++){
      const b=targets[j];
      if(r.x<b.x+b.width&&b.x<r.x+r.width&&r.y<b.y+b.height&&b.y<r.y+r.height)return false;
    }
  }
  return true;
}

function exactPhysicalBounds(a,b,scale=1) {
  // NWM floors physical/scale when reading logical coordinates. At fractional
  // DPI that loses less than one logical pixel even after a successful move.
  const expected=scale>1?nativeReadbackBounds(b,scale):b;
  return a&&expected&&['x','y','width','height'].every(k=>Math.abs(a[k]-expected[k])<0.001);
}
function identityOf(win){return {pid:win.processId,path:String(win.path||'').replaceAll('\\','/').toLowerCase()};}
function sameIdentity(win,record){const current=identityOf(win);return record&&current.pid===record.pid&&current.path===record.path;}

export class TableLayoutManager {
  constructor({ windowManager, log = () => {}, error = console.error,getLayoutWorkArea=monitor=>monitor.workArea,getLayoutTargets=()=>undefined,
    canMove=win=>win.isVisible?.()!==false&&win.isMinimized?.()!==true,now=()=>performance.now(),isDragging=()=>false } = {}) {
    if (!windowManager) throw new Error("TableLayoutManager requires a window manager");
    this.windowManager = windowManager;
    this.log = log;
    this.error = error;
    this.getLayoutWorkArea=getLayoutWorkArea;
    this.getLayoutTargets=getLayoutTargets;
    this.canMove=canMove;
    this.now=now;this.isDragging=isDragging;this.displayRepair=null;
    this.scanHadNoTables=false;
    this.originalBounds = new Map();
    this.originalIdentities = new Map();
    this.assignedBounds = new Map();
    this.order = new Map();
    this.nextOrder = 1;
    this.lastSignature = "";
    this.lastFailedSignature = '';
    this.applyRequested = false;
    this.active = false;
    this.appliedConfig = null;
    this.exactTargets = false;
  }

  reportError(message, error) {
    this.error(`[layout] ${message}:`, error?.message || error);
  }
  movable(win){try{return this.canMove(win)===true;}catch{return false;}}

  getMonitorDescriptors() {
    return monitorDescriptors(
      this.windowManager,
      (message, error) => this.reportError(message, error)
    );
  }

  getDisplays() {
    return this.getMonitorDescriptors().map(({ monitor, ...descriptor }) => descriptor);
  }

  layoutMonitor(profile,windows) {
    const monitor=resolveMonitor(this.getMonitorDescriptors(),profile);
    if(!monitor)return null;
    const ordered=this.orderedWindows(windows).sort((a,b)=>stakeLevel(b)-stakeLevel(a));
    return {...monitor,displayWorkArea:monitor.workArea,workArea:this.getLayoutWorkArea(monitor),targets:this.getLayoutTargets(monitor,ordered,profile)};
  }

  effectiveConfig(rawConfig) {
    return normalizeTableLayoutSettings(this.active&&!this.applyRequested&&this.appliedConfig?this.appliedConfig:rawConfig);
  }

  requestApply() {
    this.applyRequested = true;
  }

  migrateWindowId(previousId, nextId) {
    if (previousId === nextId) return;
    for (const map of [this.originalBounds, this.originalIdentities, this.assignedBounds, this.order]) {
      if (!map.has(previousId)) continue;
      const value = map.get(previousId);
      map.delete(previousId);
      if (!map.has(nextId)) map.set(nextId, value);
    }
  }

  orderedWindows(windows) {
    for (const win of windows) {
      if (!this.order.has(win.id)) {
        this.order.set(win.id, this.nextOrder++);
      }
    }
    return [...windows].sort((a, b) => {
      const orderDifference = this.order.get(a.id) - this.order.get(b.id);
      if (orderDifference !== 0) return orderDifference;
      return Number(a.id) - Number(b.id);
    });
  }

  signature(windows, profile, monitor) {
    return JSON.stringify({
      ids: this.orderedWindows(windows).map((win) => win.id),
      identities:this.orderedWindows(windows).map(win=>[win.id,identityOf(win)]),
      levels:this.orderedWindows(windows).map(stakeLevel),
      profile: {
        id: profile.id,
        monitorId: profile.monitorId,
        rows: profile.rows,
        columns: profile.columns,
        gap: profile.gap,
        margin: profile.margin
      },
      workArea: monitor?.workArea || null,
      display:monitor?{id:monitor.id,bounds:monitor.bounds,workArea:monitor.displayWorkArea,scaleFactor:monitor.scaleFactor}:null,
      targets:monitor?.targets
    });
  }

  apply(windows, rawConfig, reason = "manual") {
    const config = normalizeTableLayoutSettings(rawConfig);
    if (!config.enabled || !Array.isArray(windows) || windows.length === 0) {
      this.applyRequested = false;
      return false;
    }

    const profile = getActiveLayoutProfile(config);
    const monitor = this.layoutMonitor(profile,windows);
    if (!monitor) {
      this.reportError("Selected monitor is unavailable", profile.monitorId);
      this.applyRequested = false;
      return false;
    }
    if(!monitor.workArea){this.applyRequested=false;return false;}
    if(monitor.targets!==undefined&&!validTargets(monitor.targets,windows.length,monitor.workArea)){
      this.applyRequested=false;return false;
    }

    // Stable ties retain arrival order. Fill down each column so the highest
    // stakes remain grouped on the left, including Zoom and named NL tables.
    const orderedWindows = this.orderedWindows(windows).sort((a,b)=>stakeLevel(b)-stakeLevel(a));
    // GG-family tables render into a bounded aspect range. Filling arbitrary
    // desktop cells produces pillarboxing/letterboxing inside the client.
    // Use the same 7:5 table shape at every grid size; other clients retain
    // their existing layout behavior.
    const ggTables=orderedWindows.every(win=>/(?:^|[\\/])(?:ggnet|ggpoker|ggpcom|natural8|natural8net)[.]exe$/i.test(String(win.path||win.processPath||'')));
    const targets = monitor.targets ?? calculateTileRects(monitor.workArea, orderedWindows.length, profile,{columnFirst:true,tableAspectRatio:ggTables?1.4:undefined});
    const exact=monitor.targets!==undefined;
    let moved = 0;

    for (let index = 0; index < orderedWindows.length; index++) {
      const win = orderedWindows[index];
      const target = targets[index];
      try {
        if(!this.movable(win))continue;
        const current = physicalBounds(win);
        if (!this.originalBounds.has(win.id)||!sameIdentity(win,this.originalIdentities.get(win.id))) {
          this.originalBounds.set(win.id, { ...current });
          this.originalIdentities.set(win.id,identityOf(win));
        }
        if (!(exact?exactPhysicalBounds(current,target,windowScale(win)):boundsApproximatelyEqual(current,target))) {
          setPhysicalBounds(win, target);
          moved++;
        }
        let assigned = target;
        try {
          assigned = physicalBounds(win);
        } catch {}
        this.assignedBounds.set(win.id, { ...(exact?target:assigned) });
      } catch (error) {
        this.reportError(`Failed to position table ${win.id}`, error);
      }
    }

    this.lastSignature = this.signature(orderedWindows, profile, monitor);
    this.active = this.assignedBounds.size > 0;
    this.appliedConfig = config;
    this.exactTargets = exact;
    this.applyRequested = false;
    this.log(
      `[layout] Applied "${profile.name}" to ${orderedWindows.length} table(s) on ${monitor.label} (${reason}, moved ${moved})`
    );
    return true;
  }

  hasDrift(windows) {
    for (const win of windows) {
      const expected = this.assignedBounds.get(win.id);
      if (!expected) continue;
      try {
        if (!(this.exactTargets?exactPhysicalBounds(physicalBounds(win),expected,windowScale(win)):boundsApproximatelyEqual(physicalBounds(win),expected,4))) return true;
      } catch {
        return true;
      }
    }
    return false;
  }

  maybeArrange(windows, rawConfig) {
    const config = normalizeTableLayoutSettings(rawConfig);
    if (!config.enabled || !Array.isArray(windows)){this.displayRepair=null;return false;}
    if(windows.length===0){this.scanHadNoTables=true;return false;}
    const returningFromEmpty=this.scanHadNoTables;this.scanHadNoTables=false;

    const profile = getActiveLayoutProfile(this.effectiveConfig(config));
    const monitor = this.layoutMonitor(profile,windows);
    const signature = this.signature(windows, profile, monitor);
    // An impossible workspace must not repair old locked slots. In particular,
    // a second unchanged scan must remain as passive as the first refused scan.
    if(!monitor||!monitor.workArea||(monitor.targets!==undefined&&!validTargets(monitor.targets,windows.length,monitor.workArea))){
      if(!monitor&&this.lastSignature!==signature)this.reportError('Selected monitor is unavailable',profile.monitorId);
      this.assignedBounds.clear();this.applyRequested=false;this.lastSignature=signature;this.lastFailedSignature=signature;
      this.displayRepair=null;
      return false;
    }
    const initialApply = this.lastSignature === "";
    const topologyChanged = !initialApply &&
      JSON.stringify(JSON.parse(signature).identities) !== JSON.stringify(JSON.parse(this.lastSignature).identities);
    const stakesChanged=!initialApply && JSON.stringify(JSON.parse(signature).levels)!==JSON.stringify(JSON.parse(this.lastSignature).levels);
    const workAreaChanged=!initialApply&&JSON.stringify(JSON.parse(signature).workArea)!==JSON.stringify(JSON.parse(this.lastSignature).workArea);
    const targetsChanged=!initialApply&&JSON.stringify(JSON.parse(signature).targets)!==JSON.stringify(JSON.parse(this.lastSignature).targets);
    const displayChanged=!initialApply&&JSON.stringify(JSON.parse(signature).display)!==JSON.stringify(JSON.parse(this.lastSignature).display);
    const now=this.now();
    if(this.displayRepair?.signature!==signature)this.displayRepair=null;
    if(config.autoArrange&&(displayChanged||initialApply))this.displayRepair={signature,due:now+1500,expires:now+6000};
    if(this.displayRepair&&now>=this.displayRepair.due){
      if(now>this.displayRepair.expires)this.displayRepair=null;
      else if(this.isDragging())this.displayRepair=null;
      else {
        this.displayRepair=null;
        if(this.active&&config.autoArrange&&this.hasDrift(windows))return this.apply(windows,this.appliedConfig,'display-settled');
      }
    }
    const automaticStart=config.autoArrange && !this.active && this.lastFailedSignature!==signature;
    if (this.applyRequested || automaticStart || (initialApply && config.arrangeOnStartup)) {
      const reason = this.applyRequested ? 'requested' : 'automatic-start';
      const applied = this.apply(windows, config, reason);
      this.lastFailedSignature=applied?'':signature;
      if (!applied) this.lastSignature = signature;
      return applied;
    }
    if (this.active && config.autoArrange && (topologyChanged||stakesChanged||workAreaChanged||targetsChanged||displayChanged||returningFromEmpty)) {
      return this.apply(windows, this.appliedConfig, stakesChanged?'stakes-changed':'tables-changed');
    }
    let repaired = false;
    if (this.active && config.lockLayout) {
      for (const win of windows) {
        const expected = this.assignedBounds.get(win.id);
        if (!expected) continue;
        try {
          if(!this.movable(win))continue;
          if(!sameIdentity(win,this.originalIdentities.get(win.id)))continue;
          if (!(this.exactTargets?exactPhysicalBounds(physicalBounds(win),expected,windowScale(win)):boundsApproximatelyEqual(physicalBounds(win),expected,4))) {
            setPhysicalBounds(win, expected);
            repaired = true;
          }
        } catch (error) {
          this.reportError(`Failed to restore assigned slot for table ${win.id}`, error);
        }
      }
    }
    // Unchanged scans never move tables; manual mode retains explicit control.
    this.lastSignature = signature;
    return repaired;
  }

  stop(rawConfig, reason = 'disabled') {
    this.displayRepair=null;
    if (normalizeTableLayoutSettings(rawConfig).restoreOnStop) return this.restore(reason);
    this.originalBounds.clear();
    this.originalIdentities.clear();
    this.assignedBounds.clear();
    this.lastSignature = '';
    this.lastFailedSignature = '';
    this.applyRequested = false;
    this.active = false;
    this.appliedConfig = null;
    this.scanHadNoTables=false;
    return 0;
  }

  restore(reason = "disabled") {
    this.displayRepair=null;
    this.active = false;
    this.appliedConfig = null;
    if (this.originalBounds.size === 0) {
      this.assignedBounds.clear();
      this.lastSignature = "";
      this.applyRequested = false;
      return 0;
    }

    let windows = [];
    try {
      windows = this.windowManager.getWindows?.() || [];
    } catch (error) {
      this.reportError("Failed to enumerate tables for restore", error);
    }
    const nativeWindows = new Map(windows.map((win) => [win.id, win]));
    let restored = 0;
    for (const [id, originalBounds] of this.originalBounds) {
      const win = nativeWindows.get(id);
      if (!win) continue;
      try {
        if(!sameIdentity(win,this.originalIdentities.get(id))||!this.movable(win))continue;
        if(exactPhysicalBounds(physicalBounds(win),originalBounds,windowScale(win)))continue;
        setPhysicalBounds(win, originalBounds);
        restored++;
      } catch (error) {
        this.reportError(`Failed to restore table ${id}`, error);
      }
    }

    this.originalBounds.clear();
    this.originalIdentities.clear();
    this.assignedBounds.clear();
    this.lastSignature = "";
    this.applyRequested = false;
    this.log(`[layout] Restored ${restored} table(s) (${reason})`);
    return restored;
  }

  cleanup(nativeWindowIds,retainedIdentities=[]) {
    const retained=new Map(retainedIdentities.map(r=>[r.id,r.pid]));
    for (const map of [this.originalBounds, this.originalIdentities, this.assignedBounds, this.order]) {
      for (const id of map.keys()) {
        if (!nativeWindowIds.has(id)&&!(retained.has(id)&&retained.get(id)===this.originalIdentities.get(id)?.pid)) map.delete(id);
      }
    }
  }
}
