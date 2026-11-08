import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createLiveTestRuntime} from '../src/live-test-runtime.js';
import {createSimulationModel} from '../src/simulation-model.js';
import {SixShelfWorkspace} from '../src/six-shelf-workspace.js';
import {preparePokerLayoutScan} from '../src/poker-layout-scan.js';
import {TableLayoutManager} from '../src/table-layout-manager.js';
import {WorkspaceManager} from '../src/workspace-manager.js';
import {physicalToNativeBounds} from '../src/native-window-bounds.js';

test('bounded runtime applies the real planner and managers once, then only observes and stops itself',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'poker-live-test-')),root=fileURLToPath(new URL('../',import.meta.url));
 const commands=Object.fromEntries(['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'].map(k=>[k,childProcess[k]]));
 const beforeErrors=process.listeners('uncaughtException'),beforeRejections=process.listeners('unhandledRejection');
 t.after(()=>{
  Object.assign(childProcess,commands);syncBuiltinESMExports();
  for(const fn of process.listeners('uncaughtException'))if(!beforeErrors.includes(fn))process.removeListener('uncaughtException',fn);
  for(const fn of process.listeners('unhandledRejection'))if(!beforeRejections.includes(fn))process.removeListener('unhandledRejection',fn);
  fs.rmSync(directory,{recursive:true,force:true});
 });
 const model=createSimulationModel();model.fixtures.find(w=>w.id===102).setPhysicalBounds({x:10,y:10,width:404,height:582});
 const spec={tables:model.tables.map(w=>({id:w.id,pid:w.processId,path:w.path})),utilities:model.fixtures.filter(w=>w.id>100).map(w=>({id:w.id,pid:w.processId,path:w.path,title:w.title,className:'ApolloRuntimeContentWindow',role:({101:'challenge',102:'notes',103:'replay'})[w.id]}))},exits=[];
 const runtime=createLiveTestRuntime({app:{getAppPath:()=>root,exit:c=>exits.push(c)}},{directory,durationMs:60000},spec);
 const wm=runtime.wrapWindowManager(model.windowManager);
 const adapter=runtime.wrapAdapter({...model.workspaceAdapter,inspect(){throw Error('Must not send native min/max queries');},
  place:(win,rect)=>{win.setBounds(physicalToNativeBounds(rect,model.scale));return true;}},model.readDisplayState,
  (identity,rect)=>model.fixtures.find(w=>w.id===identity.id).setBounds(physicalToNativeBounds(rect,model.scale)));
 const windows=wm.getWindows(),session=new SixShelfWorkspace();
 assert.equal(runtime.preflight(windows),true);
 const prepared=preparePokerLayoutScan({tables:windows.filter(runtime.isTarget),nativeWindows:windows,session,adapter,
  monitor:{workArea:model.windowManager.getMonitors()[0].getWorkArea(),scaleFactor:1},profile:{rows:0,columns:0,gap:0,margin:0}});
 const manager=new TableLayoutManager({windowManager:wm,canMove:adapter.visible,getLayoutWorkArea:()=>prepared.plan.tableArea,
  getLayoutTargets:(_,ordered)=>session.targetsFor(ordered),error:(...args)=>{throw Error(args.join(' '));}});
 assert.equal(runtime.beginPlacement(prepared.plan,session.reservations,windows),true);
 manager.maybeArrange(prepared.layoutWindows,JSON.parse(fs.readFileSync(path.join(directory,'settings.json'))).tableLayout);
 new WorkspaceManager({adapter,error:e=>{throw e;}}).sync(runtime.placementWindows(windows),prepared.plan);
 runtime.endPlacement(windows);
 assert.equal(runtime.gate.phase,'observing');assert.equal(model.moves.length,9);assert.deepEqual(exits,[]);
 assert.equal(runtime.beginPlacement(prepared.plan,session.reservations,windows),false);
 assert.equal(runtime.preflight(wm.getWindows()),true);assert.equal(model.moves.length,9);
 model.tables[0].visible=false;
 assert.equal(runtime.preflight(wm.getWindows()),false);
 assert.equal(model.moves.length,9);assert.deepEqual(exits,[1]);
 const report=JSON.parse(fs.readFileSync(path.join(directory,'report.json')));
 assert.equal(report.status,'stopped');assert.equal(report.nativeWrites.length,9);
 assert.match(report.reason,/hidden, missing or replaced/);
});
