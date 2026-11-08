import test from "node:test";
import assert from "node:assert/strict";
import {
  boundsApproximatelyEqual,
  calculateTileRects,
  createLayoutProfile,
  deleteLayoutProfile,
  getActiveLayoutProfile,
  normalizeTableLayoutSettings,
  upsertLayoutProfile
} from "../src/table-layout.js";

test("normalizeTableLayoutSettings supplies automatic enabled defaults", () => {
  const config = normalizeTableLayoutSettings();

  assert.equal(config.enabled, true);
  assert.equal(config.autoArrange, true);
  assert.equal(config.lockLayout, false);
  assert.equal(config.arrangeOnStartup, true);
  assert.equal(config.restoreOnStop, false);
  assert.equal(config.activeProfileId, "default");
  assert.equal(config.profiles.length, 1);
  assert.equal(getActiveLayoutProfile(config).monitorId, "primary");
  const packed=calculateTileRects({x:0,y:0,width:2000,height:1400},4,getActiveLayoutProfile(config));
  assert.equal(packed[1].x,packed[0].x+packed[0].width);
  assert.equal(packed[2].y,packed[0].y+packed[0].height);
});

test("calculateTileRects honors negative monitor origins, margins, and gaps", () => {
  assert.deepEqual(
    calculateTileRects(
      { x: -1000, y: 0, width: 1000, height: 800 },
      4,
      { rows: 2, columns: 2, gap: 10, margin: 20 }
    ),
    [
      { x: -980, y: 20, width: 475, height: 375 },
      { x: -495, y: 20, width: 475, height: 375 },
      { x: -980, y: 405, width: 475, height: 375 },
      { x: -495, y: 405, width: 475, height: 375 }
    ]
  );
});

test("calculateTileRects automatically adds rows when fixed capacity is too small", () => {
  const rects = calculateTileRects(
    { x: 0, y: 0, width: 1200, height: 900 },
    5,
    { rows: 1, columns: 2, gap: 0, margin: 0 }
  );

  assert.equal(rects.length, 5);
  assert.deepEqual(rects[0], { x: 0, y: 0, width: 600, height: 300 });
  assert.deepEqual(rects[4], { x: 0, y: 600, width: 600, height: 300 });
});

test("calculateTileRects distributes remainder pixels without leaving gaps", () => {
  const rects = calculateTileRects(
    { x: 0, y: 0, width: 1001, height: 501 },
    2,
    { rows: 1, columns: 2, gap: 1, margin: 0 }
  );

  assert.deepEqual(rects, [
    { x: 0, y: 0, width: 500, height: 501 },
    { x: 501, y: 0, width: 500, height: 501 }
  ]);
});

test('proportional GG grid fits complete tables instead of stretching them into wide cells',()=>{
  assert.deepEqual(calculateTileRects({x:0,y:0,width:3840,height:2112},4,{rows:0,columns:0,gap:8,margin:0},{columnFirst:true,tableAspectRatio:1.4}),[
    {x:0,y:0,width:1472,height:1052},
    {x:0,y:1060,width:1472,height:1052},
    {x:1480,y:0,width:1472,height:1052},
    {x:1480,y:1060,width:1472,height:1052}
  ]);
  for(const [width,height,count] of [[3840,2112,6],[1920,1040,4],[1440,850,6],[1080,1920,4]]) {
    const rects=calculateTileRects({x:-width,y:20,width,height},count,{gap:8,margin:0},{columnFirst:true,tableAspectRatio:1.4});
    for(const r of rects){
      assert.ok(Math.abs(r.width/r.height-1.4)<.01);
      assert.ok(r.x>=-width&&r.y>=20&&r.x+r.width<=0&&r.y+r.height<=20+height);
    }
    for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
      const a=rects[i],b=rects[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
    }
  }
});

test('proportional grids use exactly equal dimensions even with odd remainder pixels',()=>{
  const rects=calculateTileRects({x:0,y:0,width:2935,height:2113},9,{rows:3,columns:3,gap:0,margin:0},{columnFirst:true,tableAspectRatio:1.4});
  assert.equal(new Set(rects.map(r=>`${r.width}x${r.height}`)).size,1);
  assert.equal(rects[3].x,rects[0].width);
  assert.equal(rects[1].y,rects[0].height);
});

test("profiles can be created, updated, selected, and deleted", () => {
  let config = createLayoutProfile(undefined, "Six tables");
  assert.equal(config.activeProfileId, "six-tables");
  assert.equal(config.profiles.length, 2);

  config = upsertLayoutProfile(config, {
    id: "six-tables",
    monitorId: "monitor:42",
    rows: 2,
    columns: 3,
    gap: 6,
    margin: 12
  });
  assert.deepEqual(getActiveLayoutProfile(config), {
    id: "six-tables",
    name: "Six tables",
    monitorId: "monitor:42",
    rows: 2,
    columns: 3,
    gap: 6,
    margin: 12
  });

  config = deleteLayoutProfile(config, "six-tables");
  assert.equal(config.activeProfileId, "default");
  assert.equal(config.profiles.length, 1);
});

test("boundsApproximatelyEqual tolerates small native-window jitter", () => {
  assert.equal(
    boundsApproximatelyEqual(
      { x: 10, y: 20, width: 800, height: 600 },
      { x: 12, y: 19, width: 799, height: 602 }
    ),
    true
  );
  assert.equal(
    boundsApproximatelyEqual(
      { x: 10, y: 20, width: 800, height: 600 },
      { x: 20, y: 20, width: 800, height: 600 }
    ),
    false
  );
});
