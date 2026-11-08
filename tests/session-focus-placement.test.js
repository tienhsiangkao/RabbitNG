import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {sessionFocusRect} from '../src/session-focus-layout.js';
import {ownedPanelLayout} from '../src/owned-panel-layout.js';
import {calculatePokerWorkspace} from '../src/poker-workspace.js';
const source=fs.readFileSync(new URL('../main.js',import.meta.url),'utf8');
const work={x:0,y:0,width:3840,height:2112};
const overlap=(a,b)=>a&&b&&a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
test('retained unmatched tables and a dragged shared clock remain actual placement blockers',()=>{
 const plan=calculatePokerWorkspace(work,6,{automaticPolicy:true}),initial=sessionFocusRect(work,{tables:plan.tableRects,slots:plan.slots});
 for(const role of ['retained','clock']){
  const win={id:42,processId:7,path:'C:/GGnet.exe'};
  const context=vm.createContext({liveTest:null,workspacePlan:plan,settings:{workspace:{enabled:true},overlays:{clockEnabled:true},comfort:{clockMode:'shared'}},
   tableLayoutManager:{getMonitorDescriptors:()=>[]},workspaceManager:{bindings:new Map()},workspaceAdapter:{visible:()=>true,bounds:()=>initial,inspect:()=>({})},
   workspaceClockManual:role==='clock',normalizeSessionFocus:()=>({enabled:true}),ownedPanelLayout,
   isGgProcess:()=>true,classifyPokerUtility:()=>null,sessionFocusRect,sessionFocusContext:null,sessionFocusPlacementKey:'',
   overlays:new Map(role==='retained'?[[42,{tableWin:win}]]:[]),pokerWorkspace:{reservations:role==='retained'?[{id:42,pid:7}]:[]},
   sharedClockWindow:role==='clock'?{isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>initial}:null,
   screen:{screenToDipRect:(_,r)=>r,dipToScreenRect:(_,r)=>r}});
  vm.runInContext(source.slice(source.indexOf('function updateSessionFocusContext('),source.indexOf('\nfunction syncSessionFocusPanel(')),context);
  context.updateSessionFocusContext(role==='retained'?[win]:[],[]);
  assert.equal(overlap(context.sessionFocusContext?.rect,initial),false,role+' overlaps panel');
 }
});
test('pausing scans hides and invalidates the focus placement until a fresh scan',()=>{
 const calls=[],context=vm.createContext({scanTimer:12,clearInterval(){},scanRerunRequested:true,sessionFocusContext:{rect:{}},sessionFocusPlacementKey:'stale',sessionFocusPanel:{sync:c=>calls.push(c)}});
 vm.runInContext(source.slice(source.indexOf('function stopScanner('),source.indexOf('\nfunction startSessionTimer(')),context);
 context.stopScanner();assert.equal(context.sessionFocusContext,null);assert.equal(context.sessionFocusPlacementKey,'');assert.equal(calls.at(-1)?.show,false);
});
