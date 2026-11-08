import test from 'node:test';
import assert from 'node:assert/strict';
import {LivePlacementGate} from '../src/live-test-gate.js';
import {guardLiveWindow} from '../src/live-test-window.js';
import {parseLiveTestLaunch} from '../src/live-test-options.js';
import {verifyLiveGeometry} from '../src/live-test-runtime.js';
import {makeLivePhysicalPlacer} from '../src/live-physical-placement.js';
import {LiveObservationHealth,boundedRendererRead} from '../src/live-observation-health.js';
const identities=Array.from({length:6},(_,i)=>({id:i+1,pid:99,path:'C:/GG/GGnet.exe'}));
const rect=i=>({x:i*100,y:0,width:100,height:100});
const targets=()=>identities.map((identity,i)=>({identity,rect:rect(i),kind:'table'}));
const visible=()=>identities.map(identity=>({...identity,visible:true}));
test('one bounded batch authorizes exact targets for each recorded identity once',()=>{
 const g=new LivePlacementGate(identities);g.checkExpected(visible());g.begin(targets());
 assert.equal(g.allowWrite(identities[0],rect(0)),true);g.closeBatch();
 assert.equal(g.phase,'observing');assert.throws(()=>g.allowWrite(identities[1],rect(1)));
});
test('foreign identities, wrong targets and repeated writes are denied before native calls',()=>{
 for(const operation of [g=>g.allowWrite({...identities[0],pid:100},rect(0)),
  g=>g.allowWrite(identities[0],rect(1)),g=>{g.allowWrite(identities[0],rect(0));g.allowWrite(identities[0],rect(0));}]){
  const g=new LivePlacementGate(identities);g.begin(targets());assert.throws(()=>operation(g));assert.equal(g.phase,'aborted');
 }
});
test('hidden, missing or replaced expected identities abort without survivor placement',()=>{
 for(const records of [visible().slice(1),visible().map((r,i)=>({...r,visible:i!==0})),visible().map((r,i)=>i? r:{...r,pid:100})]){
  const g=new LivePlacementGate(identities);assert.throws(()=>g.checkExpected(records));assert.equal(g.phase,'aborted');
  assert.throws(()=>g.begin(targets()));
 }
});
test('a second batch cannot be started and utilities must belong to the recorded client',()=>{
 const g=new LivePlacementGate(identities);g.begin(targets());g.closeBatch();assert.throws(()=>g.begin(targets()));
 const other=new LivePlacementGate(identities);
 assert.throws(()=>other.begin([...targets(),{identity:{id:20,pid:2,path:'C:/Other.exe'},rect:rect(7),kind:'utility'}]));
});
test('native proxy stops the underlying setter after the one approved move',()=>{
 const g=new LivePlacementGate(identities);g.begin(targets());let actualWrites=0,violations=0;
 const real={id:1,processId:99,path:'C:/GG/GGnet.exe',getMonitor:()=>({getScaleFactor:()=>1}),bringToTop(){actualWrites++;}};
 const guarded=guardLiveWindow(real,{gate:g,adapter:()=>({visible:()=>true,isAlive:()=>true}),writePhysical(){actualWrites++;},onViolation:()=>violations++,onWrite(){}});
 guarded.setBounds(rect(0));assert.equal(actualWrites,1);g.closeBatch();
 assert.throws(()=>guarded.setBounds(rect(0)));assert.equal(actualWrites,1);assert.equal(violations,1);
 assert.throws(()=>guarded.bringToTop());assert.equal(actualWrites,1);assert.equal(violations,2);
});
test('live CLI rejects missing, malformed, mixed-case or production profile arguments',()=>{
 const production='C:/Users/admin/AppData/Roaming/poker-rng-overlays',directory='C:/Users/admin/Documents/Codex/live-test-run',spec='C:/Users/admin/Documents/Codex/spec.json';
 assert.equal(parseLiveTestLaunch(['--startup'],production),null);
 assert.equal(parseLiveTestLaunch(['--live-test',`--live-test-dir=${directory}`,`--live-test-spec=${spec}`],production).durationMs,120000);
 for(const args of [['--live-test'],['--live-test=true'],['--LIVE-TEST'],['--live-test',`--live-test-dir=${production}`,`--live-test-spec=${spec}`]])assert.throws(()=>parseLiveTestLaunch(args,production));
 assert.throws(()=>parseLiveTestLaunch(['--live-test',`--live-test-dir=${directory}`,`--live-test-spec=${spec}`,'--simulate'],production));
 assert.throws(()=>parseLiveTestLaunch(['--live-test',`--live-test-dir=${directory}`,`--live-test-spec=${spec}`,'--live-test-duration-ms=60000'],production));
});
test('native proxy blocks every other native mutator, including raw owner escape',()=>{
 const g=new LivePlacementGate(identities);let calls=0;
 const real={redraw(){calls++;},setOwner(){calls++;},setOpacity(){calls++;},getOwner(){calls++;return this;}};
 const guarded=guardLiveWindow(real,{gate:g,adapter:()=>({}),onViolation(){},onWrite(){}});
 for(const name of ['redraw','setOwner','setOpacity','getOwner'])assert.throws(()=>guarded[name]());
 assert.equal(calls,0);
});
test('live facade has no native prototype and sends exactly the approved pixels with no second scale read',()=>{
 const g=new LivePlacementGate(identities);g.begin(targets());let reads=0,writes=[];
 class Native{hide(){throw Error('Native hide must be unreachable');}}
 const real=Object.assign(new Native(),{id:1,processId:99,path:identities[0].path,getMonitor:()=>({getScaleFactor:()=>{reads++;return reads===1?1:0;}})});
 const facade=guardLiveWindow(real,{gate:g,adapter:()=>({visible:()=>true,isAlive:()=>true}),writePhysical:(owner,pixels)=>writes.push(pixels),onViolation(){},onWrite(){}});
 assert.equal(Object.getPrototypeOf(facade),null);assert.equal(Object.isFrozen(facade),true);
 facade.setBounds(rect(0));assert.deepEqual(writes,[rect(0)]);assert.equal(reads,1);
});
test('zero or unknown scale denies placement instead of substituting a scale',()=>{
 for(const scale of [0,undefined,NaN]){
  const g=new LivePlacementGate(identities);g.begin(targets());let writes=0;
  const w=guardLiveWindow({id:1,processId:99,path:identities[0].path,getMonitor:()=>({getScaleFactor:()=>scale}),setBounds:()=>writes++},
   {gate:g,adapter:()=>({visible:()=>true,isAlive:()=>true}),writePhysical:()=>writes++,onViolation(){},onWrite(){}});
  assert.throws(()=>w.setBounds(rect(0)),/scale/);assert.equal(writes,0);
 }
});
test('physical native boundary rejects unreadable owners or DWM state and sends exact approved pixels',()=>{
 const moves=[],api={exists:()=>true,pid:()=>99,visible:()=>true,iconic:()=>false,cloaked:()=>false,move:(...args)=>{assert.ok(args.every(a=>typeof a==='number'),'Native integer parameters must be numbers');moves.push(args);return true;}};
 for(const pid of [null,0,100])assert.throws(()=>makeLivePhysicalPlacer({...api,pid:()=>pid})(identities[0],rect(0)));
 assert.throws(()=>makeLivePhysicalPlacer({...api,cloaked:()=>null})(identities[0],rect(0)));assert.equal(moves.length,0);
 makeLivePhysicalPlacer(api)(identities[0],rect(0));assert.deepEqual(moves,[[1,0,0,100,100,1]]);
});
test('observation cannot pass after a blind interval and requires the complete two minutes',()=>{
 let now=0;const health=new LiveObservationHealth({now:()=>now});
 for(now=0;now<=10000;now+=250)health.sample();
 assert.throws(()=>health.complete(),/Incomplete/);now=120000;assert.throws(()=>health.sample(),/gap/);
 now=0;const healthy=new LiveObservationHealth({now:()=>now});
 for(now=0;now<=120000;now+=250)healthy.sample();
 now=120000;assert.doesNotThrow(()=>healthy.complete());now=126001;assert.throws(()=>healthy.check());
});
test('a hung own renderer read has an independent bounded timeout',async()=>{
 await assert.rejects(boundedRendererRead(()=>new Promise(()=>{}),5),/timed out/);
 assert.equal(await boundedRendererRead(()=>Promise.resolve('settled'),5),'settled');
});
test('unrecorded same-client utility cannot enroll in the live gate',()=>{
 const gate=new LivePlacementGate(identities);
 assert.throws(()=>gate.begin([...targets(),{kind:'utility',identity:{id:22,pid:99,path:identities[0].path},rect:rect(6)}]));
});
test('live geometry validates identity-specific slots rather than accepting swapped or duplicated tables',()=>{
 const wins=identities.map((r,i)=>({...r,processId:r.pid,getMonitor:()=>({getScaleFactor:()=>1}),bounds:rect(i)}));
 const adapter={bounds:w=>w.bounds};
 assert.doesNotThrow(()=>verifyLiveGeometry(targets(),wins,adapter));
 [wins[0].bounds,wins[1].bounds]=[wins[1].bounds,wins[0].bounds];
 assert.throws(()=>verifyLiveGeometry(targets(),wins,adapter));
 wins[0].bounds=rect(0);wins[1].bounds=rect(0);
 assert.throws(()=>verifyLiveGeometry(targets(),wins,adapter));
});
