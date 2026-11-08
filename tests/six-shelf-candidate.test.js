import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSixShelf} from '../src/six-shelf-layout.js';
import {SixShelfSession} from '../src/table-slot-session.js';

const work={x:0,y:0,width:3840,height:2112};
const expectedTables=[
 {x:447,y:0,width:982,height:702},{x:447,y:702,width:982,height:702},
 {x:1429,y:0,width:982,height:702},{x:1429,y:702,width:982,height:702},
 {x:2411,y:0,width:982,height:702},{x:2411,y:702,width:982,height:702}];
const records=()=>[
 {id:11,pid:700,level:10,visible:true},{id:12,pid:700,level:25,visible:true},
 {id:13,pid:700,level:10,visible:true},{id:14,pid:700,level:50,visible:true},
 {id:15,pid:700,level:25,visible:true},{id:16,pid:700,level:50,visible:true}];
function verifyGeometry(p,area,scale){
 assert.equal(p.tableRects.length,6);
 assert.equal(new Set(p.tableRects.map(r=>`${r.width}x${r.height}`)).size,1);
 const rectangles=[...p.tableRects,...Object.values(p.slots)];
 for(const r of rectangles){
  for(const k of ['x','y','width','height'])assert.ok(Number.isSafeInteger(r[k]));
  assert.ok(r.x>=area.x&&r.y>=area.y&&r.width>0&&r.height>0);
  assert.ok(r.x+r.width<=area.x+area.width&&r.y+r.height<=area.y+area.height);
 }
 const t=p.tableRects[0];
 assert.ok(t.width>=Math.ceil(560*scale)&&t.height>=Math.ceil(415*scale));
 assert.ok(Math.abs(t.width-1.4*t.height)<1.5);
 assert.equal(p.tableRects[1].y,t.y+t.height);
 assert.equal(p.tableRects[2].x,t.x+t.width);
 assert.equal(p.tableRects[4].x,t.x+2*t.width);
 assert.ok(Math.abs((t.x-area.x)-(area.x+area.width-p.tableRects[5].x-t.width))<=1);
 for(let i=0;i<rectangles.length;i++)for(let j=i+1;j<rectangles.length;j++){
  const a=rectangles[i],b=rectangles[j],gap=i<6&&j<6?0:Math.ceil(8*scale);
  assert.ok(a.x+a.width+gap<=b.x||b.x+b.width+gap<=a.x||a.y+a.height+gap<=b.y||b.y+b.height+gap<=a.y);
 }
 const dims={clock:[324,192],notes:[404,582],challenge:[424,600],replay:[898,700]};
 for(const [role,[w,h]]of Object.entries(dims)){
  assert.equal(p.slots[role].width,Math.ceil(w*scale));
  assert.equal(p.slots[role].height,Math.ceil(h*scale));
  assert.equal(p.slots[role].y,p.slots.clock.y);
 }
}

test('accepted 4K arrangement preserves table size and centers both groups',()=>{
 const p=calculateSixShelf(work);
 assert.deepEqual(p.tableRects,expectedTables);
 assert.deepEqual(p.slots,{
  clock:{x:883,y:1412,width:324,height:192},notes:{x:1215,y:1412,width:404,height:582},
  challenge:{x:1627,y:1412,width:424,height:600},replay:{x:2059,y:1412,width:898,height:700}});
 verifyGeometry(p,work,1);
});
test('nonzero and negative monitor origins translate all rectangles without resizing',()=>{
 const area={...work,x:-3840,y:47},p=calculateSixShelf(area);
 assert.deepEqual(p.tableRects[0],{x:-3393,y:47,width:982,height:702});
 assert.deepEqual(p.slots.clock,{x:-2957,y:1459,width:324,height:192});
 verifyGeometry(p,area,1);
});
test('fractional scaling reserves the entire native replay minimum',()=>{
 const p=calculateSixShelf(work,{scaleFactor:1.25});
 assert.ok(p);assert.equal(p.slots.replay.width,1123);assert.equal(p.slots.replay.height,875);
 verifyGeometry(p,work,1.25);
});
test('unavailable work areas never shrink windows or substitute another grid',()=>{
 for(const [width,height,scale]of [[1920,1040,1],[2560,1440,1],[3840,2112,1.5],[3840,2112,2]]){
  assert.equal(calculateSixShelf({x:0,y:0,width,height},{scaleFactor:scale}),null);
 }
 assert.equal(calculateSixShelf(work,{tableMinimum:{width:1100,height:800}}),null);
});
test('malformed geometry and options refuse placement',()=>{
 for(const area of [null,{}, {...work,width:0},{...work,x:NaN},{...work,y:Infinity},{...work,width:3840.5}])assert.equal(calculateSixShelf(area),null);
 for(const scaleFactor of [0,-1,NaN,Infinity,'1'])assert.equal(calculateSixShelf(work,{scaleFactor}),null);
 for(const tableMinimum of [null,{}, {width:-1,height:415},{width:560,height:Infinity}])assert.equal(calculateSixShelf(work,{tableMinimum}),null);
});
test('screen and scale sweep maintains containment, separation and table proportions',()=>{
 let fitted=0,refused=0;
 for(const width of [1920,2560,3440,3840,3841,5120,7680])for(const height of [1040,1440,1600,2112,2113,2880,4224])for(const scale of [1,1.25,1.5,2]){
  const area={x:-width,y:37,width,height},p=calculateSixShelf(area,{scaleFactor:scale});
  if(p){verifyGeometry(p,area,scale);fitted++;}else refused++;
 }
 assert.ok(fitted>50);assert.ok(refused>20);
});
test('initial table bindings put higher stakes left and preserve arrival order on ties',()=>{
 const s=new SixShelfSession(calculateSixShelf(work));const result=s.sync(records());
 assert.deepEqual(result.reservations.map(r=>r.id),[14,16,12,15,11,13]);
 assert.deepEqual(result.reservations.map(r=>r.target),expectedTables);
 assert.equal(result.added.length,6);assert.deepEqual(result.unassigned,[]);
});
test('six to four to three to one to zero visible tables retains all six fixed slots',()=>{
 const s=new SixShelfSession(calculateSixShelf(work));const all=records();const initial=s.sync(all).reservations;
 for(const visibleCount of [4,3,1,0,6]){
  const result=s.sync(all.map((r,i)=>({...r,visible:i<visibleCount})));
  assert.deepEqual(result.reservations,initial);
  assert.equal(result.placements.length,visibleCount);
  assert.deepEqual(result.added,[]);
 }
});
test('missing observations do not release or reassign slots',()=>{
 const s=new SixShelfSession(calculateSixShelf(work));const initial=s.sync(records()).reservations;
 const absent=s.sync([]);assert.deepEqual(absent.reservations,initial);assert.deepEqual(absent.placements,[]);
 assert.deepEqual(s.sync(records().reverse()).reservations,initial);
});
test('overflow is reported without evicting any reserved identity',()=>{
 const s=new SixShelfSession(calculateSixShelf(work));const initial=s.sync(records()).reservations;
 const extra={id:17,pid:700,level:500,visible:true},result=s.sync([...records(),extra]);
 assert.deepEqual(result.reservations,initial);assert.deepEqual(result.unassigned,[extra]);
 assert.deepEqual(result.added,[]);
});
test('explicit identity release reuses only that slot and leaves survivors unchanged',()=>{
 const s=new SixShelfSession(calculateSixShelf(work));const initial=s.sync(records()).reservations;
 const result=s.sync([{id:17,pid:700,level:500,visible:true}],{released:[{id:14,pid:700}]});
 assert.equal(result.added.length,1);assert.equal(result.added[0].slot,0);
 assert.deepEqual(result.added[0].target,expectedTables[0]);
 assert.deepEqual(result.reservations.slice(1),initial.slice(1));
});
test('a reused window ID from another process cannot inherit or release the old identity',()=>{
 const s=new SixShelfSession(calculateSixShelf(work));const initial=s.sync(records()).reservations;
 const replacement={id:14,pid:701,level:50,visible:true};
 const result=s.sync([replacement],{released:[{id:14,pid:701}]});
 assert.deepEqual(result.reservations,initial);assert.deepEqual(result.unassigned,[replacement]);
});
test('a new hidden window consumes no slot',()=>{
 const s=new SixShelfSession(calculateSixShelf(work));
 const hidden=s.sync([{id:18,pid:700,level:100,visible:false}]);
 assert.deepEqual(hidden.reservations,[]);assert.deepEqual(hidden.added,[]);
 assert.equal(s.sync(records()).reservations.length,6);
});
test('returned targets and caller-owned plans cannot mutate retained geometry',()=>{
 const p=calculateSixShelf(work),s=new SixShelfSession(p),first=s.sync(records());
 p.tableRects[0].width=1;first.reservations[0].target.x=9999;first.added[1].target.y=9999;
 const second=s.sync(records());assert.deepEqual(second.reservations.map(r=>r.target),expectedTables);
});
test('bad or duplicate observations fail atomically before releasing existing slots',()=>{
 const s=new SixShelfSession(calculateSixShelf(work));const initial=s.sync(records()).reservations;
 for(const observed of [[{id:17,pid:700,level:NaN}], [{id:0,pid:700}], [records()[0],records()[0]],null]){
  assert.throws(()=>s.sync(observed,{released:[{id:14,pid:700}]}),TypeError);
  assert.deepEqual(s.sync([]).reservations,initial);
 }
 assert.throws(()=>s.sync([],{released:[{id:14}]}),TypeError);
 assert.deepEqual(s.sync([]).reservations,initial);
});
test('an exact 7:5 fit is not rejected by decimal multiplication rounding',()=>{
 const p=calculateSixShelf({x:0,y:0,width:3840,height:1998},{tableMinimum:{width:903,height:645}});
 assert.ok(p,'1290 available pixels hold two 645px rows; 645 × 7 / 5 is exactly 903');
 assert.equal(p.tableRects[0].width,903);assert.equal(p.tableRects[0].height,645);
});
test('sparse plan rectangles cannot produce an empty placement target',()=>{
 assert.throws(()=>new SixShelfSession({tableRects:Array(6)}),TypeError);
 const rects=[...expectedTables];delete rects[3];
 assert.throws(()=>new SixShelfSession({tableRects:rects}),TypeError);
});
test('sparse observations and releases fail atomically without freeing a slot',()=>{
 const s=new SixShelfSession(calculateSixShelf(work));const initial=s.sync(records()).reservations;
 assert.throws(()=>s.sync(Array(1),{released:[{id:14,pid:700}]}),TypeError);
 assert.deepEqual(s.sync([]).reservations,initial);
 assert.throws(()=>s.sync([],{released:Array(1)}),TypeError);
 assert.deepEqual(s.sync([]).reservations,initial);
});
test('invalid options objects refuse placement rather than throwing or using defaults',()=>{
 for(const options of [null,true,'bad',[],42])assert.equal(calculateSixShelf(work,options),null);
});
test('each sweep refusal agrees with independent integer-size feasibility enumeration',()=>{
 for(const width of [1920,2560,3440,3840,3841,5120,7680])for(const height of [1040,1440,1600,2112,2113,2880,4224])for(const scale of [1,1.25,1.5,2]){
  const native=[[324,192],[404,582],[424,600],[898,700]].map(([w,h])=>[Math.ceil(w*scale),Math.ceil(h*scale)]);
  const gap=Math.ceil(8*scale),budget=height-Math.max(...native.map(r=>r[1]))-gap;
  const toolsFit=native.reduce((sum,r)=>sum+r[0],0)+gap*3<=width;
  let possible=false;
  if(toolsFit){
   for(let h=Math.ceil(415*scale);h*2<=budget;h++){
    const w=Math.floor(h*7/5);if(w>=Math.ceil(560*scale)&&w*3<=width){possible=true;break;}
   }
   if(!possible)for(let w=Math.ceil(560*scale);w*3<=width;w++){
    const h=Math.floor(w*5/7);if(h>=Math.ceil(415*scale)&&h*2<=budget){possible=true;break;}
   }
  }
  assert.equal(calculateSixShelf({x:-width,y:37,width,height},{scaleFactor:scale})!==null,possible,`${width}x${height}@${scale}`);
 }
});
test('display reflow changes geometry but retains each identity slot',()=>{
 const s=new SixShelfSession(calculateSixShelf(work));const initial=s.sync(records()).reservations;
 s.setPlan(calculateSixShelf({...work,x:-3840,y:40}));
 const next=s.sync(records()).reservations;
 assert.deepEqual(next.map(r=>[r.id,r.pid,r.slot]),initial.map(r=>[r.id,r.pid,r.slot]));
 assert.deepEqual(next[0].target,{x:-3393,y:40,width:982,height:702});
});
test('verified canonical-handle migration preserves the original slot',()=>{
 const s=new SixShelfSession(calculateSixShelf(work));s.sync(records());
 assert.equal(s.replaceIdentity({id:14,pid:700},{id:114,pid:700}),true);
 const r=s.sync([{id:114,pid:700,level:50,visible:true}]);
 assert.equal(r.placements[0].slot,0);assert.deepEqual(r.placements[0].target,expectedTables[0]);
 assert.equal(s.replaceIdentity({id:114,pid:700},{id:214,pid:701}),false);
});
