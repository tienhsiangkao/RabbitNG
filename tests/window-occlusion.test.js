import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWindowOcclusion, nativeBoundsToDip, findVisibleOverlayRect } from '../src/window-occlusion.js';
import { dedupeTableWindows } from '../src/window-dedupe.js';
const rect = { x: 0, y: 0, width: 800, height: 600 };
const win = (id, bounds = rect, visible = true) => ({ id, getBounds: () => bounds, isVisible: () => visible });
const options = { getBounds: (w) => w.getBounds(), getOverlayRect: (b) => ({ x: b.x + 200, y: b.y + 400, width: 64, height: 48 }) };
test('a covered number stays at its anchor and hides instead of jumping to another table region', () => {
  const preferred = options.getOverlayRect(rect);
  const placed = findVisibleOverlayRect(rect, preferred, [{ x: 200, y: 0, width: 600, height: 600 }]);
  assert.equal(placed, null);
  assert.equal(findVisibleOverlayRect(rect, preferred, [rect]), null);
});
test('uncovered strips elsewhere must not attract a number away from its anchor', () => {
  const placed = findVisibleOverlayRect(rect, options.getOverlayRect(rect), [
    { x: 0, y: 0, width: 100, height: 600 }, { x: 164, y: 0, width: 636, height: 600 }
  ]);
  assert.equal(placed, null);
});
test('DWM-cloaked Start, Search and input surfaces must not hide poker overlays', () => {
  for (const processName of ['StartMenuExperienceHost.exe', 'SearchHost.exe', 'TextInputHost.exe']) {
    const surface = { ...win(1), path: `C:\\Windows\\SystemApps\\${processName}` };
    const state = { ...options, getDisplayState: w => ({ cloaked: w.id === 1 }) };
    assert.equal(computeWindowOcclusion([surface, win(2)], state).get(2), false, processName);
  }
});

test('transparent Explorer composition hosts must not hide overlays, but File Explorer must', () => {
  const explorer = { ...win(1), path: 'C:\\Windows\\explorer.exe' };
  const state = { ...options, getDisplayState: w => ({ shellSurface: w.id === 1 }) };
  assert.equal(computeWindowOcclusion([explorer, win(2)], state).get(2), false);
  assert.equal(computeWindowOcclusion([explorer, win(2)], options).get(2), true);
});

test('a genuinely displayed input pane still occludes its actual rectangle', () => {
  const inputHost = { ...win(1), path: 'C:\\Windows\\SystemApps\\TextInputHost.exe' };
  assert.equal(computeWindowOcclusion([inputHost, win(2)], options).get(2), true);
});

test('a cloaked poker table has no visible overlay', () => {
  const state = { ...options, getDisplayState: () => ({ cloaked: true }) };
  assert.equal(computeWindowOcclusion([win(2)], state).get(2), true);
});
test('only higher visible windows covering the overlay area hide it', () => {
  assert.equal(computeWindowOcclusion([win(1), win(2)], options).get(2), true);
  assert.equal(computeWindowOcclusion([win(1, rect, false), win(2)], options).get(2), false);
  assert.equal(computeWindowOcclusion([win(1, { x: 0, y: 0, width: 100, height: 100 }), win(2)], options).get(2), false);
  assert.equal(computeWindowOcclusion([win(2), win(1)], options).get(2), false);
});
test('overlay HWNDs do not occlude their own table', () => {
  assert.equal(computeWindowOcclusion([win(1), win(2)], { ...options, ignoreIds: new Set(['1']) }).get(2), false);
});
test('native logical window coordinates are restored to physical pixels before Electron DIP conversion', () => {
  const w = { ...win(1), getMonitor: () => ({ getScaleFactor: () => 1.5 }) };
  assert.deepEqual(nativeBoundsToDip(w, (r) => r), { x: 0, y: 0, width: 1200, height: 900 });
});
test('a visible duplicate HWND above the retained table must not hide its overlay', () => {
  const duplicate = { ...win(1), getTitle: () => 'Rush & Cash - $0.10 / $0.25' };
  const retained = { ...win(2), getTitle: duplicate.getTitle };
  const { canonicalIdById } = dedupeTableWindows([duplicate, retained], new Set([2]));
  assert.equal(computeWindowOcclusion([duplicate, retained], { ...options, canonicalIdById }).get(2), false);
});
