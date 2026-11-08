import test from 'node:test';
import assert from 'node:assert/strict';
import {AutomaticPokerWorkspace} from '../src/automatic-poker-workspace.js';
import {createSimulationModel} from '../src/simulation-model.js';
import {preparePokerLayoutScan} from '../src/poker-layout-scan.js';
import {TableLayoutManager} from '../src/table-layout-manager.js';
import {WorkspaceManager} from '../src/workspace-manager.js';
import {calculatePokerWorkspace,fitPokerUtilitySlot} from '../src/poker-workspace.js';
const work={x:0,y:0,width:3840,height:2112},profile={id:'automatic',monitorId:'primary',rows:0,columns:0,gap:0,margin:0};
const cfg={enabled:true,autoArrange:true,arrangeOnStartup:true,lockLayout:false,restoreOnStop:false,activeProfileId:'automatic',profiles:[profile]};
function rig(count=6,override={},selectedProfile=profile,settle=true){
 const model=createSimulationModel();for(let id=7;id<=12;id++){const w=model.addTable(id);w.minimum={width:560,height:415};model.tables.push(w);}
 model.tables.forEach((w,i)=>w.visible=i<count);
 const session=new AutomaticPokerWorkspace(),adapter={...model.workspaceAdapter,...override};let plan,area=work;
 const manager=new TableLayoutManager({windowManager:model.windowManager,canMove:adapter.visible,getLayoutWorkArea:()=>plan?.tableArea,
  getLayoutTargets:(_,ordered)=>session.targetsFor(ordered)}),tools=new WorkspaceManager({adapter});
 const scan=(now=0,tables=model.tables,native=model.windowManager.getWindows(),mixedPresence=false)=>{
  const result=preparePokerLayoutScan({tables,nativeWindows:native,session,adapter,monitor:{workArea:area,scaleFactor:model.scale},profile:selectedProfile,now,mixedPresence});
  plan=result.plan;manager.maybeArrange(result.layoutWindows,cfg);tools.sync(native,plan,now);
  manager.cleanup(new Set(native.map(w=>w.id)),session.reservations);return result;
 };
 if(settle){scan(-2000);scan(0);}
 return {model,session,manager,tools,scan,setCount:n=>model.tables.forEach((w,i)=>w.visible=i<n),setWork:w=>area=w,get plan(){return plan;}};
}
test('first batch waits two seconds from its final arrival before placing any table',()=>{
 const r=rig(1,{},profile,false);
 r.scan(0);
 r.setCount(2);r.scan(700);
 r.setCount(4);r.scan(1400);
 r.scan(3399);
 assert.equal(r.model.moves.length,0);
 r.scan(3400);
 assert.equal(r.plan.tableRects.length,4);
 for(const owner of r.session.reservations){
  assert.deepEqual(r.model.tables.find(w=>w.id===owner.id).physicalBounds(),owner.target);
  assert.equal(r.model.moves.filter(move=>move.id===owner.id).length,1);
 }
});
test('five tables reflow onto a 200% laptop display using the reported minimum size',()=>{
 const r=rig(5);
 for(const table of r.model.tables)table.minimum={width:480,height:345};
 r.model.setScale(2);
 r.setWork({x:0,y:0,width:2880,height:1380});
 r.scan(100);
 assert.equal(r.plan.mode,'full');
 assert.deepEqual(r.plan.grid,{rows:2,columns:3});
 assert.deepEqual(r.plan.slots,{});
 for(const owner of r.session.reservations){
  assert.equal(owner.target.width,960);
  assert.equal(owner.target.height,690);
  assert.deepEqual(r.model.tables.find(w=>w.id===owner.id).physicalBounds(),owner.target);
 }
});
test('all transitions 4→6→5→8→9→12→4 and reverse match a fresh current-count layout',()=>{
 for(const sequence of [[4,6,5,8,9,12,4],[12,9,8,5,6,4]]){
  const r=rig(sequence[0]);let now=100;
  for(const n of sequence.slice(1)){
   const before=r.model.moves.length;r.setCount(n);r.scan(now);r.scan(now+1500);
   assert.equal(r.model.moves.length,before,'no move while count pending');
   r.scan(now+3000);assert.equal(r.session.reservations.length,n);assert.equal(r.plan.tableRects.length,n);
   assert.deepEqual(r.plan,calculatePokerWorkspace(work,n,{automaticPolicy:true}));
   const sorted=r.session.reservations;for(const owner of sorted)assert.deepEqual(r.model.tables.find(w=>w.id===owner.id).physicalBounds(),owner.target);
   for(const [id,role]of [[101,'challenge'],[102,'notes'],[103,'replay']]){const win=r.model.fixtures.find(w=>w.id===id),target=fitPokerUtilitySlot(r.plan.slots[role],r.model.workspaceAdapter.inspect(win),1);assert.ok(Object.keys(target).every(k=>Math.abs(win.physicalBounds()[k]-target[k])<=2));}
   const settled=r.model.moves.length;r.scan(now+3300);r.scan(now+3600);assert.equal(r.model.moves.length,settled);
   now+=4000;
  }
 }
});
test('every ordered pair of counts 1–12 converges independently of its starting count',()=>{
 for(let from=1;from<=12;from++)for(let to=1;to<=12;to++){
  const r=rig(from);r.setCount(to);r.scan(100);r.scan(1600);r.scan(3100);
  assert.equal(r.plan.tableRects.length,to,`${from}->${to}`);
  assert.deepEqual(r.plan.tableRects,calculatePokerWorkspace(work,to,{automaticPolicy:true}).tableRects);
 }
});
test('temporary hide, minimized, cloaked, omission, unknown and empty desktops retain each count',()=>{
 for(const count of [4,5,6,8,9,12])for(const mode of ['temporary','minimized','cloaked','omitted','unknown','empty']){
  let unknown=false;const r=rig(count,{layoutState:win=>({nativeVisible:win.visible,minimized:win.minimized,cloaked:unknown?null:win.cloaked})});
  const before=r.model.moves.length;let tables=r.model.tables,native;
  const w=r.model.tables[count-1];
  if(mode==='temporary'||mode==='unknown')w.visible=false;
  if(mode==='minimized')w.minimized=true;if(mode==='cloaked')w.cloaked=true;
  if(mode==='unknown')unknown=true;
  if(mode==='empty')r.model.tables.forEach(x=>x.visible=false);
  if(mode==='omitted'){tables=tables.filter(x=>x!==w);native=r.model.windowManager.getWindows().filter(x=>x!==w);}
  r.scan(100,tables,native);r.scan(1100,tables,native);if(mode==='temporary')w.visible=true;
  for(const now of [2100,3100,4100,5100])r.scan(now,tables,native);
  assert.equal(r.session.reservations.length,count,`${count} ${mode}`);assert.equal(r.model.moves.length,before,`${count} ${mode}`);
 }
});
test('pending additions wait for verified minima; cached minima survive later inspection errors',()=>{
 let miss=false;const r=rig(4,{inspect:win=>miss&&win.id<=12?{}:{min:win.minimum,max:win.maximum}});
 r.setCount(5);miss=true;for(const now of [100,1100,2100,3100,4100])r.scan(now);assert.equal(r.session.reservations.length,4);
 miss=false;for(const now of [5100,6100,7100,8100])r.scan(now);assert.equal(r.session.reservations.length,5);
 r.model.tables[0].minimum={width:2200,height:1500};r.scan(8400);assert.equal(r.plan.mode,'unavailable');
 miss=true;r.setCount(4);for(const now of [8500,9500,10500,11500,12500])r.scan(now);
 assert.equal(r.plan.mode,'unavailable');
});
test('two virtual hours of hidden tools and fractional-DPI scans never reflow or repeatedly write',()=>{
 const r=rig(8);r.model.setScale(1.25);r.scan(100);const before=r.model.moves.length,plan=structuredClone(r.plan);
 for(let i=0;i<24000;i++){r.model.fixtures.filter(w=>w.id>=101).forEach(w=>w.visible=i%2===0);r.scan(400+i*300);}
 assert.deepEqual(r.plan,plan);assert.equal(r.model.moves.length,before);
 r.setWork({x:0,y:0,width:1920,height:1040});r.scan(7300000);assert.equal(r.plan.mode,'unavailable');const writes=r.model.moves.length;r.scan(7300300);assert.equal(r.model.moves.length,writes);
});
test('mixed clients and reused handles cannot take over committed owners',()=>{
 const r=rig(6);r.setCount(4);const extra=r.model.addTable(99);extra.path='C:/PokerStars.exe';extra.minimum={width:560,height:415};
 const before=r.model.moves.length;for(const now of [100,1100,2100,3100,4100])r.scan(now,[...r.model.tables,extra]);
 assert.equal(r.session.reservations.length,6);assert.equal(r.model.moves.length,before);
 extra.alive=false;const old=r.model.tables[0];old.alive=false;const replacement={...old,processId:999,path:'C:/Other.exe',visible:true};
 for(const now of [5100,6100,7100,8100])r.scan(now,[...r.model.tables.slice(1),replacement],[...r.model.windowManager.getWindows(),replacement]);
 assert.ok(r.session.reservations.every(x=>x.pid!==999));assert.equal(r.model.moves.filter(m=>m.id===1).length,1);
});

test('Auto dimensions remain automatic with gap or margin, including settled transitions',()=>{
 for(const spacing of [{gap:8},{margin:8}]){
  const r=rig(6,{}, {...profile,...spacing});r.setCount(5);r.scan(100);r.scan(1600);
  assert.equal(r.session.reservations.length,6);r.scan(3100);
  assert.deepEqual(r.plan.grid,{rows:2,columns:3});assert.equal(r.session.reservations.length,5);
 }
});
test('verified destruction of all GG owners releases ordinary foreign-client routing',()=>{
 const r=rig(6);r.model.tables.forEach(w=>w.alive=false);
 const foreign=r.model.addTable(99);foreign.path='C:/PokerStars.exe';foreign.minimum={width:560,height:415};
 let result;for(const now of [100,1600,3100,3400])result=r.scan(now,[foreign]);
 assert.equal(r.session.active,false);assert.equal(result.plan,null);assert.deepEqual(result.layoutWindows,[foreign]);
});
test('foreign-only fixed profiles keep ordinary placement without GG tool-space requirements',()=>{
 const model=createSimulationModel(),foreign=model.tables[0];foreign.path='C:/PokerStars.exe';
 const result=preparePokerLayoutScan({tables:[foreign],nativeWindows:[foreign],session:new AutomaticPokerWorkspace(),adapter:model.workspaceAdapter,
  monitor:{workArea:{x:0,y:0,width:1920,height:1040},scaleFactor:1},profile:{...profile,rows:2,columns:2},now:0});
 assert.equal(result.plan,null);assert.deepEqual(result.layoutWindows,[foreign]);
});
test('living cached hidden identities keep their verified minimum when reopened during an inspect failure',()=>{
 let miss=false;const r=rig(6,{inspect:w=>miss&&w.id===6?{}:{min:w.minimum,max:w.maximum}});
 r.setCount(5);for(const now of [100,1600,3100])r.scan(now);assert.equal(r.session.reservations.length,5);
 miss=true;r.setCount(6);for(const now of [3400,4900,6400,6700])r.scan(now);
 assert.equal(r.session.reservations.length,6);assert.equal(r.plan.tableRects.length,6);
});
test('a recognized never-place mixed container still blocks automatic GG topology changes',()=>{
 const r=rig(6);r.setCount(4);const before=r.model.moves.length;
 for(const now of [100,1600,3100,3400])r.scan(now,undefined,undefined,true);
 assert.equal(r.session.reservations.length,6);assert.equal(r.model.moves.length,before);
});


test('150% nine to twelve and back uses a minimum-sized clock-shelf fallback',()=>{
 const r=rig(9);r.model.setScale(1.5);r.setWork({x:0,y:0,width:3840,height:2088});r.scan(100);
 r.setCount(12);r.scan(200);r.scan(1800);r.scan(3300);
 assert.equal(r.plan.mode,'full');assert.equal(r.plan.toolsLimited,true);assert.equal(r.plan.tableRects.length,12);
 const rects=r.model.tables.map(w=>w.physicalBounds());
 for(let i=0;i<rects.length;i++){
  const a=rects[i];assert.ok(a.width>=840&&a.height>=622.5);
  assert.deepEqual(a,r.session.reservations.find(x=>x.id===r.model.tables[i].id).target);
  for(let j=0;j<i;j++){const b=rects[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);}
 }
 r.setCount(9);r.scan(4000);r.scan(5600);r.scan(7100);
 assert.equal(r.plan.tableRects.length,9);assert.equal(r.plan.toolsLimited,undefined);assert.ok(r.plan.slots.replay);
});

test('display scale transition repairs one late GG resize, then leaves manual movement alone',()=>{
 const r=rig(6);let now=0;r.manager.now=()=>now;
 r.model.setScale(1.5);r.scan(100);
 const target={...r.session.reservations[0].target},w=r.model.tables.find(w=>w.id===r.session.reservations[0].id);
 w.setPhysicalBounds({...target,x:12,y:100});now=1000;r.scan(1100);assert.equal(w.physicalBounds().y,100);
 now=1600;r.scan(1700);assert.deepEqual(w.physicalBounds(),target);
 w.setPhysicalBounds({...target,x:12,y:100});const moves=r.model.moves.length;now=5000;r.scan(5100);
 assert.equal(r.model.moves.length,moves,'follow-up repair is bounded to once');
});

test('100% return settles tables once and never interrupts a drag',()=>{
 const r=rig(6);let now=0,drag=false;r.manager.now=()=>now;r.manager.isDragging=()=>drag;
 r.model.setScale(1.5);r.scan(100);now=1600;r.scan(1700);
 r.model.setScale(1);now=2000;r.scan(2100);
 const owner=r.session.reservations[0],w=r.model.tables.find(w=>w.id===owner.id),target={...owner.target};
 w.setPhysicalBounds({...target,y:150});now=3600;r.scan(3700);assert.deepEqual(w.physicalBounds(),target);
 r.model.setScale(1.5);now=4000;r.scan(4100);w.setPhysicalBounds({...target,y:150});
 const before=r.model.moves.length;drag=true;now=5600;r.scan(5700);drag=false;now=6000;r.scan(6100);
 assert.equal(r.model.moves.length,before,'a user drag cancels the follow-up');
});
