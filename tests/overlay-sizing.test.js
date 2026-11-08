import test from "node:test";
import assert from "node:assert/strict";
import { rngOverlaySize,auxiliaryOverlayLayout } from "../src/overlay-sizing.js";

test('wide thin stake strips cover the promo band with doubled text at every table scale',()=>{
  for(const [width,height,oldFont] of [[560,415,12],[978,698,20],[1490,1056,30]])for(const rush of [true,false]){
    const r=auxiliaryOverlayLayout({x:0,y:0,width,height},rush).stakes;
    assert.equal(r.fontSize,oldFont*2);
    assert.equal(r.width,Math.ceil(width*.285));
    assert.equal(r.x,Math.round(width*.006));
    assert.equal(r.y,Math.round(Math.max(28,height*.035)));
    assert.equal(r.panelHeight,Math.max(28,Math.ceil(oldFont*2*1.12)));
    assert.equal(r.height,Math.max(64,r.panelHeight),'the transparent host respects the measured Windows minimum');
    assert.ok(r.panelHeight<Math.ceil(oldFont*1.65)*2,'visible strip is thinner than the previous doubled plaque');
    assert.ok(r.x+r.width<=width&&r.y+r.height<=height);
  }
});

test("rngOverlaySize scales with table size by default", () => {
  const config = {};

  assert.deepEqual(
    rngOverlaySize(config, { width: 800, height: 600 }),
    { width: 62, height: 46 }
  );
  assert.deepEqual(
    rngOverlaySize(config, { width: 2560, height: 1440 }),
    { width: 172, height: 129 }
  );
});

test('4K four-table numbers are larger and double with the same-aspect table size', () => {
  const small = rngOverlaySize({}, { width: 960, height: 540 });
  const large = rngOverlaySize({}, { width: 1920, height: 1080 });
  assert.ok(large.width >= 120 && large.width <= 140 && large.height <= 105);
  assert.ok(Math.abs(large.width - small.width * 2) <= 1);
  assert.ok(Math.abs(large.height - small.height * 2) <= 1);
});

test('legacy overlays migrate beside the hero hand once and preserve later manual placement', async () => {
  const { normalizeRngSizing } = await import('../src/overlay-sizing.js');
  const config = normalizeRngSizing({ sizeMode: 'fixed', fixedW: 64, fixedH: 48, maxW: 80, maxH: 60, anchor: { xPct: .34, yPct: .78 } });
  assert.equal(config.sizeMode, 'proportional');
  assert.equal(config.position.mode, 'hero-hand');
  assert.equal(config.scalingVersion, 5);
  assert.ok(rngOverlaySize(config, { width: 1920, height: 1080 }).width <= 140);
  assert.deepEqual(normalizeRngSizing(config), config);
  const dragged = { ...config, position: { mode: 'anchor' }, anchor: { xPct: .3, yPct: .7 } };
  assert.deepEqual(normalizeRngSizing(dragged), dragged);
});

test('RNG and auxiliary overlays keep their relative placement and scale across table sizes', async () => {
  const { auxiliaryOverlayLayout, normalizeRngSizing } = await import('../src/overlay-sizing.js');
  for (const scale of [.5, 1, 1.5]) {
    const table = { x: 100, y: 50, width: 1490 * scale, height: 1056 * scale };
    const { clock, stakes } = auxiliaryOverlayLayout(table, true);
    assert.ok(Math.abs((clock.x - table.x) / table.width - .62) < .002);
    assert.ok(Math.abs((clock.y - table.y) / table.height - .10) < .002);
    assert.ok(stakes.y-table.y>=28,'larger plaque must remain below the title bar');
    assert.ok(stakes.y+stakes.panelHeight<table.y+table.height*.17,'painted strip stays above the upper-left seat');
    assert.ok(clock.width < table.width * .18 && clock.height < table.height * .10);
    assert.ok(clock.fontSize >= Math.sqrt(table.width * table.height) * .035);
    assert.ok(stakes.fontSize >= Math.sqrt(table.width * table.height) * .023);
    const size = rngOverlaySize(normalizeRngSizing(), table);
    assert.ok(size.width < table.width * .08 && size.height < table.height * .085);
  }
});

test('hero-hand placement preserves the gap and clears cards and reaction controls across sizes and aspects', async () => {
  const { heroHandOverlayRect, normalizeRngSizing } = await import('../src/overlay-sizing.js');
  for (const [width, height] of [[800, 567], [1490, 1056], [1900, 1347], [2980, 2112], [960, 540]]) {
    const table = { x: -300, y: 100, width, height };
    const r = heroHandOverlayRect(normalizeRngSizing(), table);
    const gap = table.x + width * .43 - (r.x + r.width);
    assert.ok(Math.abs(gap / width - .012) < .002, 'gap to the left edge of the hand must scale with the table');
    assert.ok(Math.abs((r.y + r.height / 2 - table.y) / height - .76) < .002);
    assert.ok(r.y + r.height < table.y + height * .81, 'number must clear the reaction controls below it');
    assert.ok(r.x > table.x + width * .3 && r.x + r.width < table.x + width * .43);
  }
});

test("rngOverlaySize uses configured fixed target size", () => {
  assert.deepEqual(
    rngOverlaySize({ sizeMode: "fixed", fixedW: 72, fixedH: 54, minW: 64, minH: 48 }, { width: 1200, height: 800 }),
    { width: 72, height: 54 }
  );
});

test("rngOverlaySize keeps legacy proportional mode available", () => {
  const small = rngOverlaySize({ sizeMode: "proportional", minW: 64, minH: 48 }, { width: 800, height: 600 });
  const large = rngOverlaySize({ sizeMode: "proportional", minW: 64, minH: 48 }, { width: 2400, height: 1600 });

  assert.ok(small.width >= 64);
  assert.ok(small.height >= 48);
  assert.ok(large.width > small.width);
  assert.ok(large.height > small.height);
});

test("rngOverlaySize clamps fixed size to configured max", () => {
  assert.deepEqual(
    rngOverlaySize({ sizeMode: "fixed", fixedW: 120, fixedH: 90, minW: 64, minH: 48, maxW: 80, maxH: 60 }, { width: 2000, height: 1200 }),
    { width: 80, height: 60 }
  );
});
