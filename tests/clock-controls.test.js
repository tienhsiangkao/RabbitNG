import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {SessionComfort} from '../src/session-comfort.js';
const main=fs.readFileSync(new URL('../main.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../clock.html',import.meta.url),'utf8');
function renderer(){
 const elements=new Map(),actions=[];
 const document={body:{classList:{toggle(){}}},getElementById:id=>{
  if(!elements.has(id))elements.set(id,{disabled:false,classList:{toggle(){}},setAttribute(){}});
  return elements.get(id);
 }};
 const context=vm.createContext({shared:true,document,window:{clockComfort:{action:a=>actions.push(a)}}});
 vm.runInContext(html.slice(html.indexOf('function showStatus('),html.indexOf('window.clockComfort?.onStatus')),context);
 return {show:context.showStatus,button:document.getElementById('toggle-playing'),restore:document.getElementById('restore-layout'),actions};
}
test('normal clock Start and Pause remain enabled and send the correct actions',()=>{
 const h=renderer();h.show({playing:false,session:'00:00:00',controlsEnabled:true});
 assert.equal(h.button.disabled,false);h.button.onclick();assert.deepEqual(h.actions,['start-playing']);
 h.show({playing:true,session:'00:00:01',controlsEnabled:true});h.button.onclick();
 assert.equal(h.button.textContent,'Pause');assert.deepEqual(h.actions,['start-playing','pause-playing']);
});
test('bounded layout test does not present a working Start button when session actions are blocked',()=>{
 const h=renderer();h.show({playing:false,controlsEnabled:false});
 assert.equal(h.button.disabled,true);assert.equal(h.button.textContent,'Layout test');
 assert.equal(h.button.onclick,null);assert.deepEqual(h.actions,[]);
});
test('real main normal-session action transitions Start and Pause independently of test restrictions',()=>{
 const comfortSession=new SessionComfort(),calls=[];
 const context=vm.createContext({liveTest:null,comfortSession,overlays:new Map([[1,{tableWin:{id:1}}]]),
  isPokerTableWindowEffectivelyVisible:()=>true,syncComfortWindows(){},focusError:'',
  initializeFocusWindows(){},focusWindows:{enter:()=>calls.push('enter')},restoreFocusWindows:()=>calls.push('restore'),
  broadcastSettings(){},queueFrameDiagnostics(){},console});
 vm.runInContext(main.slice(main.indexOf('function setPlayingState('),main.indexOf('\nfunction destroySharedClock(')),context);
 context.setPlayingState(true);assert.equal(comfortSession.playing,true);
 context.setPlayingState(false);assert.equal(comfortSession.playing,false);assert.deepEqual(calls,['enter','restore']);
 context.liveTest={};context.setPlayingState(true);assert.equal(comfortSession.playing,false);
});
test('main clock status explicitly distinguishes normal controls from bounded test restrictions',()=>{
 const context=vm.createContext({comfortSession:new SessionComfort(),settings:{comfort:{}},comfortSessionActive:true,focusError:'',
  senderMatchesWindow:()=>true,sharedClockWindow:{},liveTest:{},overlays:new Map()});
 vm.runInContext(main.slice(main.indexOf('function clockStatusFor('),main.indexOf('\nfunction initializeFocusWindows(')),context);
 assert.equal(context.clockStatusFor({}).controlsEnabled,false);
 context.liveTest=null;assert.equal(context.clockStatusFor({}).controlsEnabled,true);
});
test('interactive shared clock can activate on a user click instead of discarding native mouse input',()=>{
 let options;
 class BrowserWindow{
  constructor(value){options=value;this.webContents={on(){}};}
  setAlwaysOnTop(){}on(){}loadFile(){return Promise.resolve();}
 }
 const context=vm.createContext({settings:{comfort:{}},screen:{screenToDipRect:(_,r)=>r,getDisplayMatching:()=>({workArea:{x:0,y:0,width:3840,height:2112}})},
  sessionFocusContext:null,workspacePlan:{slots:{clock:{x:883,y:1412,width:324,height:192}}},sharedClockProgrammaticBounds:null,workspaceClockManual:false,
  sharedClockWindow:null,sharedClockReady:false,BrowserWindow,app:{getAppPath:()=>'/app'},path:{join:(...v)=>v.join('/')},console});
 vm.runInContext(main.slice(main.indexOf('function createSharedClock('),main.indexOf('\nfunction syncComfortWindows(')),context);
 context.createSharedClock([{lastTableBounds:{x:0,y:0,width:982,height:702}}]);
 assert.equal(options.focusable,true,'A non-activating shared clock causes Windows to eat button clicks');
 assert.equal(options.show,false,'Clock still opens without taking focus');
});

test('clock offers explicit layout recovery without changing playing state',()=>{
 const h=renderer();h.show({playing:false,controlsEnabled:true,layoutEnabled:true});
 assert.equal(h.restore.disabled,false);h.restore.onclick();assert.deepEqual(h.actions,['restore-layout']);assert.equal(h.button.textContent,'Start playing');
 h.show({playing:false,controlsEnabled:true,layoutEnabled:false});assert.equal(h.restore.disabled,true);assert.equal(h.restore.onclick,null);
});
