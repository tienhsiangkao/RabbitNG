// Virtual elapsed time only. Uses production managers and synthetic windows;
// cannot load a native library, query GG, or send desktop input.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulationModel} from '../src/simulation-model.js';
import {SixShelfWorkspace} from '../src/six-shelf-workspace.js';
import {preparePokerLayoutScan} from '../src/poker-layout-scan.js';
import {TableLayoutManager} from '../src/table-layout-manager.js';
import {WorkspaceManager} from '../src/workspace-manager.js';
const originalWork={x:0,y:0,width:3840,height:2112};
const profile={id:'automatic',monitorId:'primary',rows:0,columns:0,gap:0,margin:0};
const config={enabled:true,autoArrange:true,lockLayout:false,arrangeOnStartup:true,restoreOnStop:false,activeProfileId:'automatic',profiles:[profile]};
function rig(){
 const model=createSimulationModel(),session=new SixShelfWorkspace();let plan,work={...originalWork},dragging=false;
 const adapter={...model.workspaceAdapter,isDragging:()=>dragging};
 const manager=new TableLayoutManager({windowManager:model.windowManager,canMove:adapter.visible,
  getLayoutWorkArea:()=>plan?.tableArea,getLayoutTargets:(_,ordered)=>session.targetsFor(ordered)});
 const utilities=new WorkspaceManager({adapter,error:e=>{throw e;}});
 function scan(now=0,tables=model.tables,native=model.windowManager.getWindows()){
  const prepared=preparePokerLayoutScan({tables,nativeWindows:native,session,adapter,
   monitor:{workArea:work,scaleFactor:model.scale},profile,now});plan=prepared.plan;
  manager.maybeArrange(prepared.layoutWindows,config);utilities.sync(native,plan,now);
  manager.cleanup(new Set(native.map(w=>w.id)),session.reservations);return plan;
 }
 return {model,session,manager,utilities,scan,setWork:v=>{work=v;},drag:v=>{dragging=v;},get plan(){return plan;}};
}

test('two virtual hours / 24000 scans: hide, minimize, cloak, reorder and omit never move survivors or utilities',()=>{
 const r=rig();r.scan();const bounds=r.model.tables.map(w=>w.physicalBounds()),writes=r.model.moves.length;
 const toolBounds=r.model.fixtures.slice(6).map(w=>w.physicalBounds());
 for(let tick=1;tick<=24000;tick++){
  const phase=tick%1000;
  r.model.tables.forEach((w,i)=>{w.visible=!(phase<5&&i>2);w.minimized=phase>=100&&phase<200&&i%2===0;w.cloaked=phase>=200&&phase<300&&i<2;});
  const tools=r.model.fixtures.slice(6);tools.forEach(w=>{w.visible=phase>=400;});
  const enumerated=r.model.tables.filter((_,i)=>phase>=300&&phase<400?i!==0:true);
  r.scan(tick*300,tick%2?[...enumerated].reverse():enumerated);
  assert.equal(r.model.moves.length,writes,`unexpected write at scan ${tick}`);
  assert.equal(r.session.reservations.length,6);
  if(tick%1000===0){assert.deepEqual(r.model.tables.map(w=>w.physicalBounds()),bounds);assert.deepEqual(tools.map(w=>w.physicalBounds()),toolBounds);}
 }
});

test('utility drag waits for release, hides safely and returns without shifting six tables; replayers share one slot',()=>{
 const r=rig();r.scan();const before=r.model.tables.map(w=>w.physicalBounds()),notes=r.model.fixtures.find(w=>w.id===102),target=notes.physicalBounds();
 assert.equal(r.utilities.bindings.get(102).pid,notes.processId);
 notes.setPhysicalBounds({...target,x:40});r.drag(true);r.scan(300);r.scan(1000);assert.equal(notes.physicalBounds().x,40);
 notes.visible=false;r.scan(1200);assert.equal(notes.physicalBounds().x,40);
 r.drag(false);notes.visible=true;r.scan(1500);assert.deepEqual(notes.physicalBounds(),target);
 const replay=r.model.addTable(104);replay.title='HH  Rush & Cash $0.10 / $0.25';replay.minimum={width:898,height:700};replay.maximum={width:898,height:2160};
 r.scan(1800);assert.deepEqual(replay.physicalBounds(),r.plan.slots.replay);
 for(let i=0;i<100;i++)r.scan(2100+i*300);
 assert.deepEqual(r.model.tables.map(w=>w.physicalBounds()),before);
 assert.equal(r.model.moves.filter(m=>m.id===104).length,1);
});

test('verified destruction and reopen releases one slot; other owners and foreign same-handle processes are untouched',()=>{
 const r=rig();r.scan();const before=r.model.tables.map(w=>w.physicalBounds()),old=r.model.tables[0];old.alive=false;
 r.scan(300,r.model.tables.slice(1));assert.equal(r.session.reservations.length,5);
 const replacement=r.model.addTable(20);replacement.minimum={width:560,height:415};replacement.maximum={width:9999,height:9999};
 r.model.tables[0]=replacement;r.scan(600);assert.deepEqual(replacement.physicalBounds(),before[0]);
 assert.deepEqual(r.model.tables.slice(1).map(w=>w.physicalBounds()),before.slice(1));
 const foreign={...old,processId:777,alive:true};const count=r.model.moves.length;
 r.scan(900,[...r.model.tables,foreign],[...r.model.windowManager.getWindows(),foreign]);assert.equal(r.model.moves.length,count);
});

test('display/DPI changes recover from insufficient space without reordering owners or repeated fractional writes',()=>{
 const r=rig();r.scan();const identities=r.session.reservations.map(x=>[x.id,x.pid,x.slot]);
 r.setWork({x:0,y:0,width:1920,height:1040});const before=r.model.moves.length;
 assert.equal(r.scan(300).mode,'unavailable');for(let i=0;i<10;i++)r.scan(600+i*300);
 assert.equal(r.model.moves.length,before);assert.equal(r.session.reservations.length,6);
 r.setWork(originalWork);r.model.setScale(1.25);assert.equal(r.scan(4000).mode,'full');const settled=r.model.moves.length;
 for(let i=0;i<1000;i++)r.scan(4300+i*300);assert.equal(r.model.moves.length,settled);
 assert.deepEqual(r.session.reservations.map(x=>[x.id,x.pid,x.slot]),identities);
 const targets=r.session.reservations.map(x=>x.target);assert.equal(new Set(targets.map(x=>JSON.stringify(x))).size,6);
});
