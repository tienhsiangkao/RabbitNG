import test from 'node:test';
import assert from 'node:assert/strict';
import { tableFrameLayout } from '../src/table-frame-layout.js';
const table = { x: 100, y: 50, width: 1490, height: 1056 };
const overlaps = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
const absolute = r => ({ ...r, x: r.x+table.x, y:r.y+table.y });

test('stake frame draws thinner edge lines and leaves the table center clear', () => {
  const layout = tableFrameLayout(table);
  assert.equal(layout.thickness, 6);
  assert.equal(layout.rects.length, 4);
  for (const r of layout.rects) {
    assert.ok(r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0);
    assert.ok(r.x+r.width <= table.width && r.y+r.height <= table.height);
    assert.ok(!overlaps(r, { x:100,y:100,width:1290,height:856 }));
  }
});

test('frame strokes are half their previous thickness across small tables and 4K', () => {
  const thicknesses = [[800,567],[1490,1056],[1900,1347],[2980,2112]].map(([width,height]) => tableFrameLayout({x:0,y:0,width,height}).thickness);
  assert.deepEqual(thicknesses, [4,6,8,8]);
});

test('fully covered tables have no remaining frame', () => {
  assert.deepEqual(tableFrameLayout(table, [table]).rects, []);
});

test('partial and overlapping covers clip the frame without drawing over another app', () => {
  const blockers = [
    { x: table.x, y: table.y, width: 500, height: table.height },
    { x: table.x+300, y: table.y, width: 500, height: 150 }
  ];
  const layout = tableFrameLayout(table, blockers);
  assert.ok(layout.rects.length > 0);
  for (const r of layout.rects) for (const b of blockers) assert.ok(!overlaps(absolute(r), b));
});

test('a cover over the middle preserves the visible perimeter cue', () => {
  assert.deepEqual(tableFrameLayout(table, [{x:400,y:300,width:600,height:400}]), tableFrameLayout(table));
});
