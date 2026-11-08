import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {SessionComfort,normalizeComfort} from '../src/session-comfort.js';
test('fifty minutes is the default reminder and does not force a break',()=>{
 assert.equal(normalizeComfort().breakMinutes,50);
 const s=new SessionComfort(0);s.setPlaying(true,0);s.tick(2999999,true);
 assert.equal(s.status({},2999999).breakDue,false);s.tick(3000000,true);
 assert.equal(s.status({},3000000).breakDue,true);assert.equal(s.playing,true);
});
test('ten-minute wall-clock break excludes all break time and waits for manual Resume',()=>{
 const s=new SessionComfort(0);s.setPlaying(true,0);s.tick(3000000,true);s.startBreak(3000000);
 let state=s.status({},3000000);assert.equal(state.breakActive,true);assert.equal(state.breakRemainingSeconds,600);assert.equal(state.playing,false);assert.equal(state.breakDue,false);
 s.tick(3300000,false);state=s.status({},3300000);assert.equal(state.breakRemainingSeconds,300);assert.equal(state.seconds,3000);
 s.tick(3600000,false);state=s.status({},3600000);assert.equal(state.breakActive,false);assert.equal(state.breakReady,true);assert.equal(state.playing,false);assert.equal(state.breakRemainingSeconds,0);
 s.tick(4200000,true);assert.equal(s.status({},4200000).seconds,3000);
 s.setPlaying(true,4200000);assert.equal(s.status({},4200000).breakReady,false);
 s.tick(7199999,true);assert.equal(s.status({},7199999).breakDue,false);
 s.tick(7200000,true);assert.equal(s.status({},7200000).breakDue,true);assert.equal(s.status({},7200000).seconds,6000);
});
test('early Resume deliberately finishes the break and starts a fresh work interval',()=>{
 const s=new SessionComfort(0);s.setPlaying(true,0);s.tick(3000000,true);s.startBreak(3000000);
 s.setPlaying(true,3060000);let state=s.status({},3060000);assert.equal(state.breakActive,false);assert.equal(state.breakReady,false);assert.equal(state.seconds,3000);
 s.tick(6060000,true);assert.equal(s.status({},6060000).breakDue,true);
 s.reset(6060000);assert.equal(s.status({},6060000).breakRemainingSeconds,0);
});
test('ordinary Pause does not acknowledge the due cue or start a break',()=>{
 const s=new SessionComfort(0);s.setPlaying(true,0);s.tick(3000000,true);s.setPlaying(false,3000000);s.tick(3600000,true);
 const state=s.status({},3600000);assert.equal(state.breakDue,true);assert.equal(state.breakActive,false);assert.equal(state.seconds,3000);
});
test('Start break uses the existing pause/focus-restore path and cannot act in bounded live mode',()=>{
 const main=fs.readFileSync(new URL('../main.js',import.meta.url),'utf8'),calls=[];
 const context=vm.createContext({liveTest:null,setPlayingState:v=>calls.push(['playing',v]),comfortSession:{startBreak:()=>calls.push(['break']),snooze(){},completeBreak(){}},syncComfortWindows:()=>calls.push(['sync']),queueFrameDiagnostics(){}});
 vm.runInContext(main.slice(main.indexOf('function applyBreakAction('),main.indexOf('\nfunction destroyOverlayById(',main.indexOf('function applyBreakAction('))),context);
 context.applyBreakAction('start-break');assert.deepEqual(calls.slice(0,2),[['playing',false],['break']]);
 context.liveTest={};calls.length=0;context.applyBreakAction('start-break');assert.deepEqual(calls,[]);
});
test('table mode shows each break phase on one selected clock only',()=>{
 const source=fs.readFileSync(new URL('../main.js',import.meta.url),'utf8'),selected={},other={};
 for(const phase of ['breakActive','breakReady']){
  const state={playing:false,breakDue:false,breakActive:false,breakReady:false,breakRemainingSeconds:phase==='breakActive'?550:0,[phase]:true};
  const context=vm.createContext({comfortSession:{status:()=>state},settings:{comfort:{}},comfortSessionActive:true,focusError:'',liveTest:null,
   sharedClockWindow:{},senderMatchesWindow:(sender,win)=>sender===win,overlays:new Map([[1,{clockBw:selected,comfortDue:true}],[2,{clockBw:other,comfortDue:false}]])});
  vm.runInContext(source.slice(source.indexOf('function clockStatusFor('),source.indexOf('\nfunction initializeFocusWindows(')),context);
  assert.equal(context.clockStatusFor(selected)[phase],true);assert.equal(context.clockStatusFor(selected).breakDue,false);
  const muted=context.clockStatusFor(other);assert.equal(muted.breakActive,false);assert.equal(muted.breakReady,false);assert.equal(muted.breakRemainingSeconds,0);
 }
});
test('Settings Start break routes to the same timed-break action in either clock mode',()=>{
 const source=fs.readFileSync(new URL('../settings.js',import.meta.url),'utf8'),actions=[],listeners={};
 const line=source.split('\n').find(s=>s.includes("byId('completeBreak').addEventListener"));
 vm.runInNewContext(line,{byId:()=>({addEventListener:(event,fn)=>listeners[event]=fn}),sendPatch:patch=>actions.push(patch.breakAction)});
 listeners.click();assert.deepEqual(actions,['start-break']);
});
