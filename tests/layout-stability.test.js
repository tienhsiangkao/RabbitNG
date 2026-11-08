import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {LayoutStabilityJournal} from '../src/layout-stability.js';
const bounds={x:447,y:0,width:982,height:702};
const record=(extra={})=>({id:1,pid:42,role:'table',present:true,visible:true,minimized:false,bounds,overlays:{rng:true,frame:true},...extra});
test('metadata journal is change-only, bounded, detached, and excludes content',()=>{
 const j=new LayoutStabilityJournal({limit:4,maxWindows:6});
 const r=record({title:'secret player',balance:1500});
 assert.equal(j.observe([r],{mode:'full',layout:'six-centered-shelf'},0),true);
 assert.equal(j.observe([r],{mode:'full',layout:'six-centered-shelf'},300),false);
 for(let i=0;i<10;i++)j.observe([record({bounds:{...bounds,x:i}})],{mode:'full',layout:'six-centered-shelf'},600+i);
 const snapshot=j.snapshot();assert.equal(snapshot.events.length,4);assert.ok(snapshot.droppedEvents>0);
 assert.doesNotMatch(JSON.stringify(snapshot),/secret player|balance|title/);
 snapshot.events[0].after.bounds.x=999;assert.notEqual(j.snapshot().events[0].after.bounds.x,999);
 assert.equal(j.snapshot().scans,12);
});
test('missing enumeration is recorded as missing, never as destroyed, and return preserves identity',()=>{
 const j=new LayoutStabilityJournal();j.observe([record()],null,0);j.observe([],null,300);
 let s=j.snapshot();assert.equal(s.windows[0].present,false);assert.equal(s.events.at(-1).type,'window-missing');
 assert.doesNotMatch(JSON.stringify(s),/destroyed|closed/);
 j.observe([record()],null,600);assert.equal(j.snapshot().events.at(-1).type,'window-returned');
 j.observe([record({pid:43})],null,900);s=j.snapshot();assert.equal(s.windows.filter(r=>r.present).length,1);assert.equal(s.windows.find(r=>r.pid===42).present,false);
});
test('visibility, minimized state, geometry and overlay changes each produce inspectable events',()=>{
 const j=new LayoutStabilityJournal();j.observe([record()],null,0);
 j.observe([record({visible:false,minimized:true,overlays:{rng:false,frame:false}})],null,300);
 let e=j.snapshot().events.at(-1);assert.equal(e.before.visible,true);assert.equal(e.after.minimized,true);assert.equal(e.after.overlays.rng,false);
 j.observe([record({bounds:{...bounds,x:1}})],null,600);assert.equal(j.snapshot().events.at(-1).after.bounds.x,1);
});
test('long-running observations cap identity state, sanitize invalid data, and do not execute inputs',()=>{
 const j=new LayoutStabilityJournal({limit:5,maxWindows:8});let calls=0;
 for(let i=1;i<=1000;i++)j.observe([record({id:i})],{mode:'full',layout:'six-centered-shelf'},i*300);
 assert.ok(j.snapshot().windows.length<=8);assert.ok(j.snapshot().events.length<=5);
 assert.doesNotThrow(()=>j.observe([record({id:NaN}),record({bounds:{...bounds,x:Infinity},move:()=>calls++})],null,300001));
 assert.equal(calls,0);assert.doesNotMatch(JSON.stringify(j.snapshot()),/Infinity|move/);
});

test('actual scanner observer uses only supplied identities, survives read failures and cannot request placement',()=>{
 const source=fs.readFileSync(new URL('../main.js',import.meta.url),'utf8'),journal=new LayoutStabilityJournal();let queued=0;
 const win={id:1,processId:42,isMinimized:()=>false};
 const context=vm.createContext({layoutStability:journal,pokerWorkspace:{reservations:[]},workspaceManager:{bindings:new Map()},
  workspaceAdapter:{bounds:()=>{throw Error('transient read');},visible:()=>true},overlays:new Map(),workspacePlan:null,
  queueFrameDiagnostics:()=>queued++,logVerbose(){}});
 vm.runInContext(source.slice(source.indexOf('function observeLayoutStability('),source.indexOf('\nasync function scanTables()')),context);
 context.observeLayoutStability([win,{id:99,processId:123}], [win]);
 assert.equal(journal.snapshot().windows.length,1);assert.equal(journal.snapshot().windows[0].bounds,null);
 assert.equal(journal.snapshot().windows[0].visible,true);assert.equal(queued,1);
 context.observeLayoutStability([win],[win]);assert.equal(queued,1);
 context.observeLayoutStability([],[]);assert.equal(journal.snapshot().events.at(-1).type,'window-missing');
 assert.match(source,/observeLayoutStability\(nativeWindows,wins\)/);
 assert.match(source,/stability:layoutStability.snapshot\(\)/);
});

test('production-shaped windows use adapter minimized state and stale utility handles exclude foreign processes',()=>{
 const source=fs.readFileSync(new URL('../main.js',import.meta.url),'utf8'),journal=new LayoutStabilityJournal();
 const win={id:1,processId:42}; // node-window-manager has no isMinimized method.
 const context=vm.createContext({layoutStability:journal,pokerWorkspace:{reservations:[]},
  workspaceManager:{bindings:new Map([[99,{pid:42,slotKey:'notes',identity:'[42,"GGnet.exe","notes"]'}]])},
  workspaceAdapter:{bounds:()=>bounds,visible:()=>false,minimized:()=>true},overlays:new Map(),workspacePlan:null,
  queueFrameDiagnostics(){},logVerbose(){}});
 vm.runInContext(source.slice(source.indexOf('function observeLayoutStability('),source.indexOf('\nasync function scanTables()')),context);
 context.observeLayoutStability([win,{id:99,processId:777}], [win]);
 let snapshot=journal.snapshot();assert.equal(snapshot.windows[0].minimized,true);assert.equal(snapshot.windows.length,1);
 context.workspaceAdapter.minimized=()=>{throw Error('unknown state');};context.observeLayoutStability([win],[win]);
 assert.equal(journal.snapshot().windows[0].minimized,null);
 context.observeLayoutStability([win,{id:99,processId:42}], [win]);snapshot=journal.snapshot();
 assert.ok(snapshot.windows.some(r=>r.id===99&&r.pid===42));
});
