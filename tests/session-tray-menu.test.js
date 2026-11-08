import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {SessionComfort} from '../src/session-comfort.js';
import {buildSessionTrayItems} from '../src/session-tray-menu.js';

test('tray uses the same session model through due, snooze, timed break and manual resume',()=>{
 let now=0;const s=new SessionComfort(now),actions=[];
 const cfg={breakMinutes:50};
 const menu=()=>buildSessionTrayItems(s.status(cfg,now),{
  setPlaying:playing=>{actions.push(playing);s.setPlaying(playing,now);},
  breakAction:action=>{if(action==='start-break')s.startBreak(now);if(action==='snooze')s.snooze();},
  reset:()=>s.reset(now)});
 const item=label=>menu().find(x=>x.label===label);
 item('Start playing').click();s.tick(now=3000000,true);
 assert.ok(item('Break due'));item('Snooze 10 playing min').click();assert.equal(s.status(cfg,now).breakDue,false);
 s.tick(now+=600000,true);assert.ok(item('Break due'));
 item('Start 10 min break').click();assert.equal(s.playing,false);assert.ok(item('Break remaining: 10:00'));
 assert.equal(item('Start 10 min break').enabled,false);assert.equal(item('Snooze 10 playing min').enabled,false);
 now+=600000;s.tick(now,false);assert.ok(item('Break finished — resume when ready'));assert.equal(s.playing,false);
 item('Resume playing').click();assert.equal(s.status(cfg,now).breakReady,false);assert.equal(s.status(cfg,now).seconds,3600);
 assert.equal(s.status(cfg,now).breakDue,false);item('Pause playing').click();assert.equal(s.playing,false);
 item('Reset session timer').click();assert.equal(s.status(cfg,now).seconds,0);assert.deepEqual(actions,[true,true,false]);
});

test('tray early Resume and custom work intervals retain the counted session',()=>{
 let now=0;const s=new SessionComfort(0);s.setPlaying(true,0);s.tick(now=2700000,true);
 let items=buildSessionTrayItems(s.status({breakMinutes:45},now),{setPlaying:v=>s.setPlaying(v,now),breakAction:()=>s.startBreak(now),reset(){}});
 assert.ok(items.some(x=>x.label==='Break due'));items.find(x=>x.label==='Start 10 min break').click();
 now+=60000;items=buildSessionTrayItems(s.status({},now),{setPlaying:v=>s.setPlaying(v,now),breakAction(){},reset(){}});
 items.find(x=>x.label==='Resume playing').click();assert.equal(s.elapsed,2700000);assert.equal(s.breakUntil,0);
});

test('tray reports effective Paused while Playing remains selected behind hidden tables',()=>{
 let requested;
 const items=buildSessionTrayItems({session:'00:12:34',playing:true,paused:true},{setPlaying:v=>requested=v,breakAction(){},reset(){}});
 assert.equal(items[0].label,'Playing time: 00:12:34 · Paused');
 items.find(x=>x.label==='Pause playing').click();assert.equal(requested,false);
});

test('actual main tray template uses unified handlers and contains no independent timer',()=>{
 const source=fs.readFileSync(new URL('../main.js',import.meta.url),'utf8'),calls=[];
 const state={playing:false,session:'00:12:34'};
 const context=vm.createContext({settings:{tableLayout:{},comfort:{},autoStartEnabled:false},
  normalizeTableLayoutSettings:()=>({profiles:[]}),getActiveLayoutProfile:()=>({}),
  Menu:{buildFromTemplate:x=>x},overlays:new Map(),comfortSession:{status:()=>state},
  buildSessionTrayItems,setPlayingState:v=>calls.push(['play',v]),applyBreakAction:v=>calls.push(['break',v]),
  resetSessionTimer:()=>calls.push(['reset']),comfortSessionActive:false,scanTimer:null,overlaysManuallyHidden:false,
  currentAutoRollInterval:3,quietMode:true,showOnlyActiveTables:false});
 vm.runInContext(source.slice(source.indexOf('function buildMenu()'),source.indexOf('\nfunction createTray()')),context);
 const items=context.buildMenu();items.find(x=>x.label==='Start playing').click();items.find(x=>x.label==='Start 10 min break').click();items.find(x=>x.label==='Reset session timer').click();
 assert.deepEqual(calls,[['play',true],['break','start-break'],['reset']]);
 state.playing=true;state.paused=false;
 assert.equal(context.buildMenu()[1].label,'Playing time: 00:12:34 · Paused');
 assert.doesNotMatch(source,/pomodoroTimer|pomodoroIsRunning|startPomodoro|resetPomodoro|Start Work \(25m\)|Start Break \(5m\)/);
});
