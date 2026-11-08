import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulationModel} from '../src/simulation-model.js';
import {SixShelfWorkspace} from '../src/six-shelf-workspace.js';
import {preparePokerLayoutScan} from '../src/poker-layout-scan.js';
import {TableLayoutManager} from '../src/table-layout-manager.js';
import {WorkspaceManager} from '../src/workspace-manager.js';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const work={x:0,y:0,width:3840,height:2112};
const profile={id:'automatic',monitorId:'primary',rows:0,columns:0,gap:0,margin:0};
const cfg={enabled:true,autoArrange:true,arrangeOnStartup:true,lockLayout:false,restoreOnStop:false,activeProfileId:'automatic',profiles:[profile]};
function fixture(adapterOverride={}){
 const model=createSimulationModel(),session=new SixShelfWorkspace();let plan;
 const adapter={...model.workspaceAdapter,...adapterOverride};
 const manager=new TableLayoutManager({windowManager:model.windowManager,canMove:adapter.visible,
  getLayoutWorkArea:()=>plan?.tableArea,getLayoutTargets:(_,ordered)=>session.active?session.targetsFor(ordered):plan?.tableRects});
 const tools=new WorkspaceManager({adapter});
 function scan(now,tables=model.tables,native=model.windowManager.getWindows(),p=profile){
  const result=preparePokerLayoutScan({tables,nativeWindows:native,session,adapter,monitor:{workArea:work,scaleFactor:1},profile:p,now});
  plan=result.plan;manager.maybeArrange(result.layoutWindows,cfg);tools.sync(native,plan,now);
  return result;
 }
 scan(0);return {model,session,manager,scan,get plan(){return plan;}};
}
function closeTwo(f){f.model.tables[4].visible=false;f.model.tables[5].visible=false;}

test('six to four native-hidden but alive tables settles into the existing four-table plan once',()=>{
 const f=fixture();closeTwo(f);const before=f.model.moves.length;
 f.scan(100);f.scan(2000);f.scan(3099);assert.equal(f.plan.tableRects.length,6);assert.equal(f.model.moves.length,before);
 f.scan(3100);assert.equal(f.plan.tableRects.length,4);assert.equal(f.session.active,false);
 assert.deepEqual(f.model.tables[0].physicalBounds(),{x:0,y:0,width:1467,height:1047});
 assert.equal(f.model.moves.filter(m=>m.id===5).length,1);assert.equal(f.model.moves.filter(m=>m.id===6).length,1);
 const settled=f.model.moves.length;for(let i=0;i<20;i++)f.scan(3400+i*300);
 assert.equal(f.model.moves.length,settled);
});

test('confirmed destruction also releases the six-layout capacity after the settled count',()=>{
 const f=fixture();f.model.tables[4].alive=false;f.model.tables[5].alive=false;
 for(const now of [100,1000,2000,3100])f.scan(now,f.model.tables.slice(0,4));
 assert.equal(f.plan.tableRects.length,4);assert.equal(f.session.active,false);
});

test('temporary hide, minimized, cloaked, live omission, unknown visibility and empty desktop retain six slots',()=>{
 for(const mode of ['temporary','minimized','cloaked','omitted','unknown','empty']){
  const f=fixture(mode==='unknown'?{layoutState:()=>{throw Error('unknown');}}:{});const before=f.model.moves.length;
  let tables=f.model.tables,native;
  if(mode==='temporary'||mode==='unknown')closeTwo(f);
  if(mode==='minimized')f.model.tables.slice(4).forEach(w=>{w.minimized=true;});
  if(mode==='cloaked')f.model.tables.slice(4).forEach(w=>{w.cloaked=true;});
  if(mode==='omitted'){tables=f.model.tables.slice(0,4);native=f.model.windowManager.getWindows().filter(w=>w.id!==5&&w.id!==6);}
  if(mode==='empty')f.model.tables.forEach(w=>{w.visible=false;});
  f.scan(100,tables,native);f.scan(1000,tables,native);
  if(mode==='temporary')f.model.tables.forEach(w=>{w.visible=true;});
  for(const now of [2000,3100,4000,5000,6000])f.scan(now,tables,native);
  assert.equal(f.plan.tableRects.length,6,mode);assert.equal(f.session.reservations.length,6,mode);assert.equal(f.model.moves.length,before,mode);
 }
});

test('a scan suspension or changing visible owners restarts the settling interval',()=>{
 const f=fixture();closeTwo(f);f.scan(100);f.scan(10000);assert.equal(f.plan.tableRects.length,6);
 f.scan(11000);f.model.tables[3].visible=false;f.model.tables[4].visible=true;f.scan(12000);f.scan(13000);f.scan(14000);
 assert.equal(f.plan.tableRects.length,6);f.scan(15000);assert.equal(f.plan.tableRects.length,4);
});

test('restoring all six after adaptive four returns to the six-table shelf and keeps utilities fitted',()=>{
 const f=fixture();closeTwo(f);for(const now of [100,1000,2000,3100])f.scan(now);
 assert.equal(f.plan.tableRects.length,4);
 f.model.tables.forEach(w=>{w.visible=true;});f.scan(3400);assert.equal(f.plan.layout,'six-centered-shelf');
 assert.equal(f.session.reservations.length,6);
 for(const [id,role]of [[101,'challenge'],[102,'notes'],[103,'replay']])assert.deepEqual(f.model.fixtures.find(w=>w.id===id).physicalBounds(),f.plan.slots[role]);
 const settled=f.model.moves.length;f.scan(3700);assert.equal(f.model.moves.length,settled);
});

test('custom six-grid profile and unassigned extra identities never authorize a count shrink',()=>{
 const f=fixture();closeTwo(f);const custom={...profile,rows:2,columns:3};
 for(const now of [100,1000,2000,3100,4000])f.scan(now,undefined,undefined,custom);
 assert.equal(f.session.active,true);assert.equal(f.plan.tableRects.length,6);
 const extra=f.model.addTable(7);extra.minimum={width:560,height:415};
 for(const now of [5000,6000,7000,8000,9000])f.scan(now,[...f.model.tables,extra]);
 assert.equal(f.session.active,true);assert.equal(f.plan.tableRects.length,6);
});

test('failed DWM reads remain explicitly unknown and cannot authorize a hidden-table reflow',()=>{
 const source=fs.readFileSync(new URL('../src/windows-display-state.js',import.meta.url),'utf8');let status=-1;
 const context=vm.createContext({process:{platform:'win32',env:{SystemRoot:'C:\\Windows'}},path,Buffer,
  koffi:{load:()=>({func:signature=>signature.includes('DwmGetWindowAttribute')?()=>status:()=>0})}});
 vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace('export function','function'),context);
 const read=context.createWindowDisplayStateReader();assert.equal(read({id:1}).cloakedKnown,false);
 status=0;assert.equal(read({id:1}).cloakedKnown,true);
 const f=fixture({layoutState:()=>({nativeVisible:false,minimized:false,cloaked:null})});closeTwo(f);
 for(const now of [100,1000,2000,3100,4000])f.scan(now);assert.equal(f.plan.tableRects.length,6);
});

test('a visible foreign-client table cannot join or trigger a six-to-four settlement',()=>{
 const f=fixture();closeTwo(f);const foreign=f.model.addTable(99);foreign.path='C:/PokerStars.exe';foreign.minimum={width:560,height:415};
 const before=f.model.moves.length;
 for(const now of [100,1100,2100,3100,3400,4400])f.scan(now,[...f.model.tables,foreign]);
 assert.equal(f.plan.tableRects.length,6);assert.equal(f.session.active,true);assert.equal(f.model.moves.length,before);
});

test('unknown cloak state on a surviving table prevents settlement too',()=>{
 const f=fixture({layoutState:win=>({nativeVisible:win.visible,minimized:win.minimized,cloaked:win.id===4?null:win.cloaked})});
 closeTwo(f);for(const now of [100,1100,2100,3100,4100])f.scan(now);
 assert.equal(f.plan.tableRects.length,6);assert.equal(f.session.active,true);
});

test('a verified native minimum survives settlement and later inspection timeouts',()=>{
 let missed=false;
 const f=fixture({inspect:win=>missed?{}:{min:win.minimum,max:win.maximum}});
 f.model.tables[0].minimum={width:2200,height:1500};f.scan(50);assert.equal(f.plan.mode,'unavailable');
 missed=true;closeTwo(f);
 for(const now of [100,1100,2100,3100,3400,4400])f.scan(now);
 assert.equal(f.plan.mode,'unavailable');
 const settled=f.model.moves.length;f.scan(4700);assert.equal(f.model.moves.length,settled);
 missed=false;f.model.tables[0].minimum={width:560,height:415};f.scan(5000);
 assert.equal(f.plan.tableRects.length,4);
});
