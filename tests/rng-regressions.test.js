import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRngRoll } from '../src/rng-state.js';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const renderer = fs.readFileSync(new URL('../renderer.js', import.meta.url), 'utf8');

function mainHarness() {
  let now = 10000;
  const sent = [];
  const entry = { lastRngValue: 0, lastRollAt: 0, bw: { webContents: { send: (...args) => sent.push(args) } } };
  const context = vm.createContext({
    console: { error() {} }, Date: { now: () => now }, overlaysManuallyHidden: false,
    overlays: new Map([[1, entry]]), settings: { turnRecognition: { enabled: true } },
    quietMode: true, logVerbose() {}, randomInt: (min) => min,
    isPlayerTurn: async () => true, createRngRoll,
  });
  const start = main.indexOf('async function triggerRollForTable(');
  const end = main.indexOf('\nfunction createOverlayFor(', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(main.slice(start, end), context);
  return { context, entry, sent, advance: () => { now += 1000; } };
}

function rendererHarness() {
  let now = 0, id = 0;
  const timeouts = new Map(), intervals = new Map(), reports = [], requests = [], handlers = {};
  const num = { children: [{}, {}], style: {}, classList: { add() {}, remove() {} }, animate() {} };
  const context = vm.createContext({
    console, Uint32Array, crypto: { getRandomValues: (buf) => { buf[0] = 0; return buf; } },
    window: { rng: {
      reportValue: (...args) => reports.push(args), requestRoll: (...args) => requests.push(args),
      onRollNow: (cb) => { handlers.roll = cb; },
      onSetAutoRollInterval: (cb) => { handlers.interval = cb; },
    } },
    document: { body: {}, getElementById: (key) => key === 'num' ? num : { addEventListener: (key, cb) => { handlers[key] = cb; } }, querySelector: () => ({ clientWidth: 46, clientHeight: 36 }) },
    ResizeObserver: class { observe() {} },
    setTimeout: (cb, delay) => { timeouts.set(++id, { at: now + delay, cb }); return id; },
    clearTimeout: (key) => timeouts.delete(key),
    setInterval: (cb, delay) => { intervals.set(++id, { cb, delay }); return id; },
    clearInterval: (key) => intervals.delete(key),
  });
  vm.runInContext(renderer, context);
  const advance = (ms) => { now += ms; for (const [key, timer] of [...timeouts]) if (timer.at <= now) { timeouts.delete(key); timer.cb(); } };
  return { context, handlers, reports, requests, intervals, advance, value: () => Number(num.children.map((n) => n.textContent).join('')) };
}

test('main permits consecutive identical independent draws', async () => {
  const h = mainHarness();
  for (let i = 0; i < 2; i++) { await h.context.triggerRollForTable(1, 'overlay-manual', { forceRepeat: true }); h.advance(); }
  assert.deepEqual(h.sent.map(([, target]) => typeof target === 'object' ? target.value : target), [0, 0]);
});

test('renderer commits an authoritative repeated value exactly', () => {
  const h = rendererHarness();
  h.handlers.roll({ value: 0, rollId: 1 }); h.advance(420);
  h.handlers.roll({ value: 0, rollId: 2 }); h.advance(420);
  assert.equal(h.value(), 0);
  assert.deepEqual(h.reports.at(-1), [0, 2]);
});

test('rapid rolls commit the latest target within the original animation deadline', () => {
  const h = rendererHarness();
  h.handlers.roll({ value: 50, rollId: 1 }); h.advance(200);
  h.handlers.roll({ value: 0, rollId: 2 }); h.advance(220);
  assert.deepEqual(h.reports.at(-1), [0, 2]);
  h.handlers.roll({ value: 80, rollId: 1 }); h.advance(420);
  assert.equal(h.value(), 0, 'late roll must not replace a newer one');
});

test('initial, right click and interval rolls request main-process draws', () => {
  const h = rendererHarness();
  assert.deepEqual(h.requests, [['initial']]);
  assert.equal(h.reports.length, 0, 'renderer must not generate the initial production value');
  h.handlers.contextmenu({ preventDefault() {} });
  assert.deepEqual(h.requests.at(-1), ['manual']);
  h.handlers.interval(1000);
  [...h.intervals.values()].find((timer) => timer.delay === 1000).cb();
  assert.deepEqual(h.requests.at(-1), ['interval']);
});

test('renderer rejection sampling supports the full uint32 range without wrapping', () => {
  const h = rendererHarness();
  h.context.crypto.getRandomValues = (buf) => { buf[0] = 0xFFFFFFFF; return buf; };
  assert.equal(vm.runInContext('secureIntInclusive(0xFFFFFFFF)', h.context, { timeout: 100 }), 0xFFFFFFFF);
  assert.throws(() => vm.runInContext('secureIntInclusive(-1)', h.context, { timeout: 100 }), /maximum/);
  assert.throws(() => vm.runInContext('secureIntInclusive(1.5)', h.context, { timeout: 100 }), /maximum/);
  let calls = 0;
  h.context.crypto.getRandomValues = (buf) => { buf[0] = calls++ === 0 ? 0xFFFFFFFF : 99; return buf; };
  assert.equal(vm.runInContext('secureIntInclusive(99)', h.context, { timeout: 100 }), 99);
  assert.equal(calls, 2, 'the incomplete modulo bucket must be rejected');
});

test('invalid and duplicate roll messages never change a committed target', () => {
  const h = rendererHarness();
  h.handlers.roll({ value: 42, rollId: 1 }); h.advance(420);
  for (const target of [null, 43, { value: 100, rollId: 2 }, { value: 5, rollId: 1 }, { value: 5, rollId: '2' }]) h.handlers.roll(target);
  h.advance(420);
  assert.equal(h.value(), 42);
  assert.deepEqual(h.reports, [[42, 1]]);
});



test('production window initialization preserves the renderer font after delayed callbacks', () => {
  const start = main.indexOf('function createOverlayFor('), end = main.indexOf('\nfunction createStakesOverlay(', start);
  assert.ok(end > start);
  const style = { fontSize: '34px' }, timers = [];
  let ready;
  const browser = {
    webContents: { send() {}, executeJavaScript: (source) => vm.runInNewContext(source, { document: { getElementById: () => ({ style }) } }) },
    setIgnoreMouseEvents() {}, setAlwaysOnTop() {}, showInactive() {},
    loadFile: () => Promise.resolve(), on() {}, once: (_event, cb) => { ready = cb; },
  };
  const context = vm.createContext({
    console, Date, overlays: new Map(), logVerbose() {}, getTableBounds: (win) => win.getBounds(),
    overlayRectFor: () => ({ x: 0, y: 0, width: 64, height: 48 }),
    BrowserWindow: function () { return browser; }, path: { join: (...parts) => parts.join('/') },
    app: { getAppPath: () => '.' }, iconPath: '', getBrowserWindowHandleKey: () => 1,
    isPokerTableWindowEffectivelyVisible: () => true, overlaysManuallyHidden: false,
    showOnlyActiveTables: false, currentAutoRollInterval: 0, PROGRAMMATIC_MOVE_SUPPRESS_MS: 0,
    settings: { overlays: { buyInEnabled: false, clockEnabled: false } },
    lastOcclusionMap: new Map(),
    lastOverlayPlacements: new Map(),
    setTimeout: (cb) => timers.push(cb),
  });
  vm.runInContext(main.slice(start, end), context);
  context.createOverlayFor({ id: 1, getTitle: () => 'table', getBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }) });
  ready(); timers.forEach((cb) => cb());
  assert.equal(style.fontSize, '34px');
});


test('timer-only main ignores focus, visibility and legacy turn triggers', async () => {
  const h = mainHarness();
  for (const reason of ['active-focus', 'overlay-shown', 'turn-scan']) {
    assert.equal(await h.context.triggerRollForTable(1, reason, { forceRepeat: true }), false);
  }
  assert.equal(h.sent.length, 0);
  assert.equal(await h.context.triggerRollForTable(1, 'overlay-interval', { forceRepeat: true }), true);
  assert.equal(h.sent.length, 1);
});
