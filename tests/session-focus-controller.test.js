import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionFocusPanel} from '../src/session-focus-panel.js';
import {normalizeSessionFocus} from '../src/session-focus.js';
test('owned focus panel uses inactive showing, guarded sender, stable bounds and visibility lifecycle',()=>{
 const created=[],events={};let visible=false,destroyed=false,moves=0,shows=0,focus=0,hidden=0;
 class FakeWindow{
  constructor(options){this.options=options;this.bounds=options;created.push(this);this.webContents={send(){},setWindowOpenHandler(){},on(){},once:(name,fn)=>events[name]=fn};}
  on(name,fn){events[name]=fn;}isDestroyed(){return destroyed;}isVisible(){return visible;}getBounds(){return this.bounds;}
  setBounds(b){this.bounds=b;moves++;}showInactive(){visible=true;shows++;}hide(){visible=false;hidden++;}focus(){focus++;}
  setAlwaysOnTop(){}loadFile(){return Promise.resolve();}destroy(){destroyed=true;}
 }
 const panel=new SessionFocusPanel({BrowserWindow:FakeWindow,root:'C:/app',getState:()=>normalizeSessionFocus(),onHide(){}});
 const ctx={show:true,rect:{x:10,y:20,width:324,height:400}};
 panel.sync(ctx);assert.equal(created.length,1);assert.equal(created[0].options.focusable,true);assert.equal(visible,false);
 events['did-finish-load']();assert.equal(visible,true);assert.equal(shows,1);assert.equal(focus,0);
 assert.equal(panel.accepts(created[0].webContents),true);assert.equal(panel.accepts({}),false);
 panel.sync(ctx);assert.equal(moves,0);panel.sync({...ctx,show:false});assert.equal(visible,false);assert.ok(hidden>0);
 panel.sync(ctx);assert.equal(created.length,1);panel.destroy();assert.equal(destroyed,true);assert.equal(panel.accepts(created[0].webContents),false);
});
test('native close catches synchronous persistence failures and reports a retryable Hide',async()=>{
 const events={},sent=[];class FakeWindow{
  constructor(){this.webContents={send:(...args)=>sent.push(args),on(){},once(){},setWindowOpenHandler(){}};}
  on(name,fn){events[name]=fn;}setAlwaysOnTop(){}loadFile(){return Promise.resolve();}isDestroyed(){return false;}
 }
 const panel=new SessionFocusPanel({BrowserWindow:FakeWindow,root:'C:/app',getState:()=>({}),onHide(){throw Error('disk full');}});
 panel.create({x:0,y:0,width:324,height:400});
 assert.doesNotThrow(()=>events.close({preventDefault(){}}));await new Promise(r=>setTimeout(r,0));
 assert.ok(sent.some(([channel,patch])=>channel==='session-focus:failure'&&patch.enabled===false));
});
