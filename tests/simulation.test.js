import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {parseSimulationLaunch} from '../src/simulation-options.js';
import {createSimulationModel} from '../src/simulation-model.js';
import {createHiddenSimulationBrowserWindow} from '../src/simulation-browser-window.js';
import {installSimulationGuards} from '../src/simulation-guards.js';
import {claimSimulationDirectory,publishSimulationReport} from '../src/simulation-profile.js';
import {scheduleSimulation} from '../src/simulation-schedule.js';
import {recordSimulationRngCommit} from '../src/simulation-runtime.js';
const production=path.resolve('C:/Users/admin/AppData/Roaming/poker-rng-overlays');
const isolated=path.resolve('C:/Users/admin/Documents/Codex/simulation-test-profile');
test('ordinary launches stay ordinary and explicit simulation requires a separate absolute directory',()=>{
 assert.equal(parseSimulationLaunch(['app.exe','--startup'],production),null);
 const result=parseSimulationLaunch(['app.exe','--simulate',`--simulation-dir=${isolated}`],production);
 assert.equal(result.directory,isolated);assert.equal(result.timeoutMs,45000);
});
test('incomplete or malformed simulation flags fail closed before normal startup',()=>{
 for(const args of [ ['--simulate'], [`--simulation-dir=${isolated}`],['--simulate','--simulation-dir=relative'],
  ['--simulate',`--simulation-dir=${production}`],['--simulate',`--simulation-dir=${path.dirname(production)}`],
  ['--simulate',`--simulation-dir=${path.join(production,'nested')}`],
  ['--simulate','--simulate',`--simulation-dir=${isolated}`],
  ['--simulate=true'],['--simulation'],['--SIMULATE'],['-simulate'],
  ['--simulate',`--simulation-dir=${isolated}`,'--simulation-timeout-ms=999999'] ]){
  assert.throws(()=>parseSimulationLaunch(args,production));
 }
});
test('the simulation backend contains only synthetic fixtures and records only fake movement',()=>{
 const model=createSimulationModel();const tables=model.tables;
 assert.equal(tables.length,6);assert.equal(model.windowManager.getWindows().length,9);
 assert.ok(tables.every(w=>w.path==='C:/PokerRNG-Simulation/GGnet.exe'));
 model.workspaceAdapter.place(tables[0],{x:447,y:0,width:982,height:702},{},1);
 assert.deepEqual(tables[0].getBounds(),{x:447,y:0,width:982,height:702});
 assert.equal(model.moves.length,1);assert.equal(model.windowManager.getActiveWindow(),null);
});
test('visibility and destruction simulation change metadata without calling external APIs',()=>{
 const model=createSimulationModel();model.tables[0].visible=false;
 assert.equal(model.workspaceAdapter.visible(model.tables[0]),false);
 assert.equal(model.workspaceAdapter.isAlive({id:model.tables[0].id,pid:model.tables[0].processId}),true);
 model.tables[0].alive=false;
 assert.equal(model.workspaceAdapter.isAlive({id:model.tables[0].id,pid:model.tables[0].processId}),false);
 assert.equal(model.windowManager.getWindows().length,8);
});
test('simulation windows cannot show or focus a real desktop surface',()=>{
 let shown=0,focused=0;const created=[];
 class FakeWindow {
  constructor(options){this.options=options;this.webContents={setFrameRate(){}};created.push(this);}
  show(){shown++;}showInactive(){shown++;}focus(){focused++;}moveTop(){focused++;}
  isVisible(){return false;}getBounds(){return {x:0,y:0,width:64,height:64};}
  setBounds(){}on(){}isDestroyed(){return false;}
 }
 const BrowserWindow=createHiddenSimulationBrowserWindow(FakeWindow,()=>{});
 const w=new BrowserWindow({x:200,y:100,width:300,height:200,show:true,alwaysOnTop:true,focusable:true});
 w.show();w.showInactive();w.focus();w.moveTop();
 assert.equal(shown,0);assert.equal(focused,0);assert.equal(w.isVisible(),true);
 assert.equal(created[0].options.show,false);assert.equal(created[0].options.webPreferences.offscreen,true);
 assert.equal(created[0].options.alwaysOnTop,false);assert.equal(created[0].options.focusable,false);
 assert.deepEqual(w.getBounds(),{x:200,y:100,width:300,height:200});
});
test('profile claims cannot overwrite existing results or use a production junction alias',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pokerrng-sim-test-'));
 const production=path.join(root,'production'),dir=path.join(root,'fresh');fs.mkdirSync(production);
 const claimed=claimSimulationDirectory(dir,production);
 publishSimulationReport(claimed.directory,{status:'passed'});
 assert.throws(()=>claimSimulationDirectory(dir,production));
 assert.throws(()=>publishSimulationReport(dir,{status:'failed'}));
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'report.json'))).status,'passed');
 const alias=path.join(root,'alias');fs.symlinkSync(production,alias,process.platform==='win32'?'junction':'dir');
 assert.throws(()=>claimSimulationDirectory(path.join(alias,'nested'),production));
 assert.equal(fs.existsSync(path.join(production,'nested')),false);
 const resolved=path.resolve(root),prefix=path.join(path.resolve(os.tmpdir()),'pokerrng-sim-test-');
 if(!resolved.startsWith(prefix))throw Error('Refusing test cleanup outside owned temp prefix');
 fs.rmSync(resolved,{recursive:true});
});
test('startup scheduling returns before readiness and orders the network fence before main',async()=>{
 let ready;const promise=new Promise(resolve=>{ready=resolve;}),stages=[];
 const result=scheduleSimulation({ready:()=>promise,initialize:()=>stages.push('network'),
  loadMain:async()=>stages.push('main'),run:async()=>stages.push('run'),failed:error=>{throw error;}});
 assert.equal(result,undefined);assert.deepEqual(stages,[]);
 ready();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(stages,['network','main','run']);
});
test('late renderer commits never dereference a destroyed window webContents getter',()=>{
 const destroyed={isDestroyed:()=>true,get webContents(){throw Error('Object has been destroyed');}};
 const owned=new Map([[1,{win:destroyed,contentsId:10}],[2,{win:{isDestroyed:()=>false},contentsId:20}]]),commits=new Map();
 assert.equal(recordSimulationRngCommit(owned,commits,{id:20},{tableId:1,value:42,rollId:2}),true);
 assert.equal(commits.get(20).value,42);
 assert.equal(recordSimulationRngCommit(owned,commits,{id:10},{tableId:1,value:7,rollId:1}),false);
});
test('capability guards reject native modules and child commands',()=>{
 const loaded=[],fakeModule={_load:request=>{loaded.push(request);return {};}};
 const cp={exec(){throw Error('Original must not run');}},calls=installSimulationGuards({Module:fakeModule,childProcess:cp,syncBuiltinESMExports(){}});
 fakeModule._load('electron');assert.deepEqual(loaded,['electron']);
 for(const request of ['koffi','node-window-manager','C:/app/node_modules/koffi/index.js'])assert.throws(()=>fakeModule._load(request),/disabled/);
 assert.throws(()=>cp.exec('reg.exe'),/disabled/);assert.throws(()=>cp.spawn('anything'),/disabled/);
 assert.equal(calls.nativeModuleAttempts,3);assert.equal(calls.childCommandAttempts,2);
});
