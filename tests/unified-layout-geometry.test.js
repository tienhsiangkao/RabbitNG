import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePokerWorkspace} from '../src/poker-workspace.js';
const work={x:0,y:0,width:3840,height:2112};
const plan=(n,area=work,options={})=>calculatePokerWorkspace(area,n,{automaticPolicy:true,...options});
function verify(p,area,count,scale){
 if(p.mode==='unavailable'){assert.equal(p.tableRects,null);assert.deepEqual(p.slots,{});return;}
 assert.equal(p.tableRects.length,count);assert.equal(new Set(p.tableRects.map(r=>`${r.width}:${r.height}`)).size,1);
 const all=[...p.tableRects,...Object.values(p.slots)];
 for(const r of all){
  const allowed=r===p.slots.replay?(p.replayBottomOverflow||0):0;
  assert.ok(r.x>=area.x&&r.y>=area.y&&r.x+r.width<=area.x+area.width&&r.y+r.height<=area.y+area.height+allowed,JSON.stringify({area,count,r}));
 }
 for(let i=0;i<all.length;i++)for(let j=0;j<i;j++){
  const a=all[i],b=all[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,JSON.stringify({area,count,a,b}));
 }
 for(const r of p.tableRects){assert.ok(r.width>=560*scale&&r.height>=415*scale);assert.ok(Math.abs(r.width/r.height-1.4)<.005);}
}
test('five and six use the same compact three-column/two-row geometry and shelf',()=>{
 const five=plan(5),six=plan(6);
 assert.deepEqual(five.grid,{columns:3,rows:2});assert.deepEqual(six.grid,five.grid);
 assert.deepEqual(five.tableRects,six.tableRects.slice(0,5));assert.deepEqual(five.slots,six.slots);
 assert.deepEqual(six.tableRects[0],{x:342,y:0,width:1052,height:752});
 assert.deepEqual(six.slots.clock,{x:2427,y:1512,width:520,height:308});
});
test('partial layouts keep the positions and utility shelf of their full preset',()=>{
 for(const [capacity,columns,rows,first] of [[4,2,2,1],[6,3,2,5],[9,3,3,7],[12,4,3,10]]){
  const full=plan(capacity);
  assert.deepEqual(full.grid,{columns,rows});
  for(let n=first;n<=capacity;n++){
   const partial=plan(n);
   assert.deepEqual(partial.grid,full.grid);
   assert.deepEqual(partial.tableRects,full.tableRects.slice(0,n));
   if(n!==8)assert.deepEqual(partial.slots,full.slots);
  }
 }
});
test('every fitted preset is bounded, disjoint and respects native minimum sizes',()=>{
 for(const [width,height]of [[3840,2112],[3841,2113],[2560,1440],[1920,1040],[7680,4272]])for(const scale of [1,1.25,1.5,2])for(let n=1;n<=12;n++){
  const area={x:-width,y:37,width,height};
  verify(plan(n,area,{scaleFactor:scale}),area,n,scale);
 }
});
test('automatic output ignores old six-specific preference and refuses oversized native constraints',()=>{
 for(let n=1;n<=12;n++)assert.deepEqual(plan(n),plan(n,work,{preferSixReviewLayout:true}));
 assert.equal(plan(12,work,{tableMinimum:{width:900,height:700}}).mode,'unavailable');
});
test('laptop nine-slot preset uses a compact notes and clock rail to enlarge the tables',()=>{
 const area={x:0,y:0,width:2880,height:1752},p=plan(9,area);
 verify(p,area,9,1);
 assert.ok(p.tableRects[0].width>=658*1.1);
 assert.deepEqual(Object.keys(p.slots),['notes','clock']);
 assert.ok(plan(9).slots.replay);
});
test('eight tables use the vacant cell for a fixed replayer on laptop and 4K',()=>{
 for(const [width,height] of [[2880,1752],[3840,2112]]){
  const area={x:0,y:0,width,height};
  const eight=plan(8,area),nine=plan(9,area),cell=nine.tableRects[8];
  verify(eight,area,8,1);
  assert.deepEqual(eight.tableRects,nine.tableRects.slice(0,8));
  assert.deepEqual(eight.slots.replay,{x:cell.x,y:cell.y,width:898,height:700});
  assert.deepEqual(eight.slots.notes,nine.slots.notes);
  assert.deepEqual(eight.slots.clock,nine.slots.clock);
  assert.equal(eight.replayBottomOverflow??0,width===2880?116:0);
 }
});
