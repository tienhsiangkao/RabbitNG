import test from 'node:test';import assert from 'node:assert/strict';
import {ownedPanelLayout} from '../src/owned-panel-layout.js';
import {calculatePokerWorkspace} from '../src/poker-workspace.js';
const work={x:0,y:0,width:3840,height:2112};
const intersects=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
test('six tables use the free shelf for a wide focus panel and a larger clock without changing tables',()=>{
 const p=calculatePokerWorkspace(work,6,{automaticPolicy:true}),before=JSON.stringify(p);
 const r=ownedPanelLayout(work,{tables:p.tableRects,slots:p.slots,scaleFactor:1});
 assert.ok(r.focus.width>=600&&r.focus.height>=550);assert.ok(r.clock.width>=480&&r.clock.height>=280);
 assert.equal(JSON.stringify(p),before);
});
test('all fitted counts and DPI keep owned panels inside work and clear of tables, tools and each other',()=>{
 for(const scale of [1,1.25,1.5,2])for(let n=1;n<=12;n++){
  const area={...work,x:-3840,y:27},p=calculatePokerWorkspace(area,n,{automaticPolicy:true,scaleFactor:scale});if(p.mode!=='full')continue;
  const r=ownedPanelLayout(area,{tables:p.tableRects,slots:p.slots,scaleFactor:scale});
  const blocks=[...p.tableRects,...Object.entries(p.slots).filter(([role])=>role!=='clock').map(([,r])=>r)];
  for(const panel of [r.clock,r.focus].filter(Boolean)){
   assert.ok(panel.x>=area.x&&panel.y>=area.y&&panel.x+panel.width<=area.x+area.width&&panel.y+panel.height<=area.y+area.height);
   for(const block of blocks)assert.equal(intersects(panel,block),false,`${n} @${scale}`);
  }
  if(r.clock&&r.focus)assert.equal(intersects(r.clock,r.focus),false);
 }
});
test('actual blockers and a manually dragged clock are respected; no-fit fails closed',()=>{
 const p=calculatePokerWorkspace(work,6,{automaticPolicy:true});
 const clock={x:0,y:1600,width:520,height:308};const r=ownedPanelLayout(work,{tables:p.tableRects,slots:p.slots,actual:[clock],fixedClock:clock});
 assert.deepEqual(r.clock,clock);if(r.focus)assert.equal(intersects(r.focus,clock),false);
 assert.deepEqual(ownedPanelLayout(work,{tables:[work],slots:{}}),{clock:null,focus:null});
 assert.deepEqual(ownedPanelLayout(work,{actual:[null]}),{clock:null,focus:null});
});

test('separate free regions beat a smaller grouped pair',()=>{
 const r=ownedPanelLayout({x:0,y:0,width:1230,height:600},{tables:[{x:650,y:0,width:30,height:600}]});
 assert.deepEqual([r.focus.width,r.focus.height],[640,592]);assert.deepEqual([r.clock.width,r.clock.height],[520,308]);
});
test('disabled owned panels reserve no space',()=>{
 const area={x:0,y:0,width:650,height:600};
 const focusOnly=ownedPanelLayout(area,{clockEnabled:false});assert.equal(focusOnly.clock,null);assert.equal(focusOnly.focus.width,640);
 const clockOnly=ownedPanelLayout(area,{focusEnabled:false});assert.equal(clockOnly.focus,null);assert.equal(clockOnly.clock.width,520);
 assert.deepEqual(ownedPanelLayout(area,{clockEnabled:false,focusEnabled:false}),{clock:null,focus:null});
});
