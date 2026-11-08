import test from 'node:test';
import assert from 'node:assert/strict';
import {SixShelfWorkspace} from '../src/six-shelf-workspace.js';
import {TableLayoutManager} from '../src/table-layout-manager.js';
import {calculatePokerWorkspace} from '../src/poker-workspace.js';
import {preparePokerLayoutScan} from '../src/poker-layout-scan.js';
const work={x:0,y:0,width:3840,height:2112};
const profile={id:'automatic',monitorId:'primary',rows:0,columns:0,gap:0,margin:0};
const config={enabled:true,autoArrange:true,lockLayout:false,arrangeOnStartup:true,restoreOnStop:false,activeProfileId:'automatic',profiles:[profile]};
function rig(scale=1){
 const monitor={id:1,isPrimary:()=>true,isValid:()=>true,getBounds:()=>work,getWorkArea:()=>work,getScaleFactor:()=>scale};
 const tables=Array.from({length:6},(_,i)=>{
  let bounds={x:20,y:30,width:800,height:600};
  return {id:i+1,processId:123,path:'C:/test/GGnet.exe',level:i<4?25:10,visible:true,minimized:false,moves:[],
   getTitle(){return `Rush & Cash - $${this.level===25?'0.10 / $0.25':'0.05 / $0.10'}`;},
   getMonitor:()=>monitor,getBounds:()=>({...bounds}),setBounds(next){bounds={...next};this.moves.push({...next});},
   isVisible(){return this.visible;},isMinimized(){return this.minimized;}};
 });
 const shelf=new SixShelfWorkspace();let plan;
 const manager=new TableLayoutManager({windowManager:{getMonitors:()=>[monitor],getWindows:()=>tables},
  getLayoutWorkArea:()=>plan?.tableArea,getLayoutTargets:(_,ordered)=>shelf.targetsFor(ordered)});
 function scan(visible=tables.filter(w=>w.visible&&!w.minimized),destroyed=[]){
  plan=shelf.update(visible.map(w=>({id:w.id,pid:w.processId,level:w.level,visible:true})),
   {workArea:work,scaleFactor:scale,tableMinimum:{width:560,height:415},destroyed});
  manager.maybeArrange(visible,config);return plan;
 }
 return {tables,shelf,manager,scan,get plan(){return plan;}};
}
test('preferred six-table app planner selects the accepted centered shelf',()=>{
 const p=calculatePokerWorkspace(work,6,{preferSixReviewLayout:true});
 assert.equal(p.layout,'six-centered-shelf');
 assert.deepEqual(p.tableRects[0],{x:447,y:0,width:982,height:702});
 assert.deepEqual(p.slots.replay,{x:2059,y:1412,width:898,height:700});
});
test('actual layout manager keeps all survivor bounds through six-to-zero-to-six visibility',()=>{
 const r=rig();r.scan();const bounds=r.tables.map(w=>w.getBounds());
 for(const count of [4,3,1,0,6]){
  r.tables.forEach((w,i)=>{w.visible=i<count;});r.scan();
  assert.deepEqual(r.tables.map(w=>w.getBounds()),bounds);
  assert.deepEqual(r.tables.map(w=>w.moves.length),[1,1,1,1,1,1]);
  assert.equal(r.shelf.reservations.length,6);
 }
});
test('a temporary enumeration omission preserves table and utility geometry',()=>{
 const r=rig();r.scan();const initial=structuredClone(r.plan);
 r.scan(r.tables.slice(0,3));assert.deepEqual(r.plan,initial);
 assert.deepEqual(r.tables.map(w=>w.moves.length),[1,1,1,1,1,1]);
});
test('confirmed destruction releases one slot; a reopened identity takes only that slot',()=>{
 const r=rig();r.scan();const target=r.tables[0].getBounds();
 const replacement={...r.tables[0],id:101,moves:[]};
 const visible=[replacement,...r.tables.slice(1)];r.scan(visible,[{id:1,pid:123}]);
 assert.equal(r.shelf.reservations.length,6);assert.deepEqual(replacement.getBounds(),target);
 assert.deepEqual(r.tables.slice(1).map(w=>w.moves.length),[1,1,1,1,1]);
});
test('reused handle in a new process cannot be moved using an old identity target',()=>{
 const r=rig();r.scan();r.tables[0].processId=456;
 r.scan();assert.equal(r.tables[0].moves.length,1);
 assert.equal(r.shelf.unassigned.length,1);
});
test('explicit reset permits a fresh table-count choice instead of retaining stale capacity',()=>{
 const r=rig();r.scan();r.shelf.reset();
 assert.equal(r.shelf.update([{id:1,pid:123,level:25}],{workArea:work}),null);
 assert.equal(r.shelf.active,false);
});
test('display changes update all slot targets without changing identity order',()=>{
 const r=rig();r.scan();const order=r.shelf.reservations.map(w=>[w.id,w.slot]);
 const p=r.shelf.update(r.tables.map(w=>({id:w.id,pid:w.processId,level:w.level})),{workArea:{...work,x:-3840,y:40}});
 assert.deepEqual(r.shelf.reservations.map(w=>[w.id,w.slot]),order);
 assert.deepEqual(p.tableRects[0],{x:-3393,y:40,width:982,height:702});
});
test('unavailable display retains reservations and suppresses placement targets until fit returns',()=>{
 const r=rig();r.scan();const observed=r.tables.map(w=>({id:w.id,pid:w.processId,level:w.level}));
 const p=r.shelf.update(observed,{workArea:{x:0,y:0,width:1920,height:1040}});
 assert.equal(p.mode,'unavailable');assert.equal(r.shelf.reservations.length,6);
 assert.equal(r.shelf.targetsFor(r.tables),null);
 assert.equal(r.shelf.update(observed,{workArea:work}).mode,'full');
});
test('locked layout never repairs a hidden native window',()=>{
 const r=rig();r.scan();const hidden=r.tables[5];hidden.visible=false;
 hidden.setBounds({x:5,y:5,width:500,height:500});const before=hidden.moves.length;
 r.manager.maybeArrange(r.tables,{...config,lockLayout:true});
 assert.equal(hidden.moves.length,before);
});
test('restore cannot resize an unrelated process that reused an original window ID',()=>{
 const r=rig();r.scan();r.tables[0].processId=999;const before=r.tables[0].moves.length;
 r.manager.restore();assert.equal(r.tables[0].moves.length,before);
});
test('125% native coordinate quantization does not cause repeated locked moves',()=>{
 const r=rig(1.25);
 for(const win of r.tables){
  let physical={x:20,y:30,width:800,height:600};
  win.getBounds=()=>Object.fromEntries(Object.entries(physical).map(([k,v])=>[k,Math.floor(v/1.25)]));
  win.setBounds=next=>{physical=Object.fromEntries(Object.entries(next).map(([k,v])=>[k,v*1.25]));win.moves.push({...next});};
 }
 r.scan();const before=r.tables.map(w=>w.moves.length);
 for(let i=0;i<5;i++)r.manager.maybeArrange(r.tables,{...config,lockLayout:true});
 assert.deepEqual(r.tables.map(w=>w.moves.length),before);
});
test('direct six-zero-six return compares restored bounds even when locking is off',()=>{
 const r=rig();r.scan();const original=r.tables[0].getBounds();r.scan([]);
 r.tables[0].setBounds({x:0,y:0,width:600,height:500});r.scan();
 assert.deepEqual(r.tables[0].getBounds(),original);
});
test('same HWND and stake with a verified replacement PID gets an initial placement',()=>{
 const r=rig();r.scan();r.tables[0].processId=456;
 r.tables[0].setBounds({x:5,y:5,width:500,height:500});r.scan(r.tables,[{id:1,pid:123}]);
 assert.deepEqual(r.tables[0].getBounds(),r.plan.tableRects[0]);
});
test('cleanup retains original restore bounds during a temporary enumeration omission',()=>{
 const r=rig();const initial=r.tables[0].getBounds();r.scan();
 r.manager.cleanup(new Set(r.tables.slice(1).map(w=>w.id)),r.shelf.reservations);
 r.scan();r.manager.restore();assert.deepEqual(r.tables[0].getBounds(),initial);
});
test('read-only native eligibility blocks minimized or cloaked writes even if visible bit is set',()=>{
 const table={id:1,processId:123,path:'C:/GGnet.exe',getBounds:()=>({x:0,y:0,width:600,height:500}),
  moves:0,setBounds(){this.moves++;},isVisible:()=>true};
 const monitor={id:1,isPrimary:()=>true,isValid:()=>true,getBounds:()=>work,getWorkArea:()=>work};
 const manager=new TableLayoutManager({windowManager:{getMonitors:()=>[monitor]},canMove:()=>false});
 manager.maybeArrange([table],config);assert.equal(table.moves,0);
});
test('175% write-side and read-side rounding does not cause repeated moves',()=>{
 const area={x:0,y:0,width:4800,height:2800},scale=1.75,shelf=new SixShelfWorkspace();
 const tables=Array.from({length:6},(_,i)=>{
  let physical={x:100,y:100,width:800,height:600};
  return {id:i+1,processId:9,path:'C:/GGnet.exe',moves:0,
   getTitle:()=> 'Rush & Cash - $0.10 / $0.25',getMonitor:()=>({getScaleFactor:()=>scale}),
   getBounds:()=>Object.fromEntries(Object.entries(physical).map(([k,v])=>[k,Math.floor(v/scale)])),
   setBounds(next){physical=Object.fromEntries(Object.entries(next).map(([k,v])=>[k,Math.floor(v*scale)]));this.moves++;}};
 });
 const plan=shelf.update(tables.map(w=>({id:w.id,pid:w.processId,level:25})),{workArea:area,scaleFactor:scale});
 const monitor={id:1,isValid:()=>true,isPrimary:()=>true,getBounds:()=>area,getWorkArea:()=>area,getScaleFactor:()=>scale};
 const manager=new TableLayoutManager({windowManager:{getMonitors:()=>[monitor]},getLayoutWorkArea:()=>plan.tableArea,getLayoutTargets:(_,ordered)=>shelf.targetsFor(ordered)});
 manager.maybeArrange(tables,{...config,lockLayout:true});
 for(let i=0;i<5;i++)manager.maybeArrange(tables,{...config,lockLayout:true});
 assert.deepEqual(tables.map(w=>w.moves),[1,1,1,1,1,1]);
});
test('real scanner preparation isolates six owners from seventh and non-GG candidates',()=>{
 const r=rig();const adapter={visible:w=>w.visible!==false&&!w.cloaked&&!w.iconic,
  inspect:w=>({min:w.minimum||{width:560,height:415}}),isAlive:()=>true};
 const prepare=tables=>preparePokerLayoutScan({tables,nativeWindows:tables,session:r.shelf,adapter,
  monitor:{workArea:work,scaleFactor:1},profile});
 prepare(r.tables);
 const extra={...r.tables[0],id:99,minimum:{width:2000,height:2000}};
 let prepared=prepare([...r.tables,extra]);
 assert.equal(prepared.plan.mode,'full');assert.equal(prepared.layoutWindows.length,6);
 prepared=prepare([...r.tables,{...extra,path:'C:/PokerStars.exe'}]);
 assert.equal(prepared.plan.layout,'six-centered-shelf');assert.equal(prepared.layoutWindows.length,6);
 r.tables[0].cloaked=true;prepared=prepare(r.tables);assert.equal(prepared.layoutWindows.length,5);
});
test('confirmed release removes only that owner minimum; overflow minima never affect the shelf',()=>{
 const shelf=new SixShelfWorkspace();const observed=recordsForMinima();
 const options={workArea:work,tableMinimum:{width:560,height:415}};
 let p=shelf.update(observed,options);assert.equal(p.mode,'unavailable');
 p=shelf.update(observed.slice(1),{...options,destroyed:[{id:1,pid:42}]});assert.equal(p.mode,'full');
 const owners=[...observed.slice(1),{id:99,pid:42,level:10,minimum:{width:560,height:415}}];
 shelf.update(owners,options);
 p=shelf.update([...owners,{id:100,pid:42,level:1000,minimum:{width:3000,height:3000}}],options);
 assert.equal(p.mode,'full');
});
function recordsForMinima(){return Array.from({length:6},(_,i)=>({id:i+1,pid:42,level:10,
 minimum:i===0?{width:1100,height:800}:{width:560,height:415}}));}
test('outside a reserved six-session, non-GG tables retain their normal layout path',()=>{
 const r=rig();const stars={...r.tables[0],path:'C:/PokerStars.exe'};
 const result=preparePokerLayoutScan({tables:[stars],nativeWindows:[stars],session:r.shelf,
  adapter:{visible:()=>true,inspect:()=>({})},monitor:{workArea:work,scaleFactor:1},profile});
 assert.equal(result.plan,null);assert.equal(result.layoutWindows[0],stars);assert.equal(r.shelf.active,false);
});
test('scanner preparation and real managers jointly preserve known slots while extras remain untouched',()=>{
 const r=rig();let plan;
 const adapter={visible:w=>w.visible!==false&&!w.iconic&&!w.cloaked,inspect:()=>({min:{width:560,height:415}}),isAlive:()=>true};
 const monitor={id:1,isPrimary:()=>true,isValid:()=>true,getBounds:()=>work,getWorkArea:()=>work,getScaleFactor:()=>1};
 const manager=new TableLayoutManager({windowManager:{getMonitors:()=>[monitor],getWindows:()=>r.tables},canMove:adapter.visible,
  getLayoutWorkArea:()=>plan?.tableArea,getLayoutTargets:(_,ordered)=>r.shelf.targetsFor(ordered)});
 const scan=(tables)=>{
  const prepared=preparePokerLayoutScan({tables,nativeWindows:r.tables,session:r.shelf,adapter,monitor:{workArea:work,scaleFactor:1},profile});
  plan=prepared.plan;manager.maybeArrange(prepared.layoutWindows,config);
  manager.cleanup(new Set(r.tables.map(w=>w.id)),r.shelf.reservations);
 };
 scan(r.tables);const targets=r.tables.map(w=>w.getBounds());
 const extra={...r.tables[5],id:99,path:'C:/PokerStars.exe',moves:[]};
 scan([...r.tables,extra]);assert.deepEqual(extra.moves,[]);
 r.tables.forEach(w=>{w.visible=false;});scan(r.tables);
 r.tables[0].setBounds({x:0,y:0,width:600,height:500});
 r.tables.forEach(w=>{w.visible=true;});scan([...r.tables,extra]);
 assert.deepEqual(r.tables.map(w=>w.getBounds()),targets);
 assert.deepEqual(extra.moves,[]);
});
