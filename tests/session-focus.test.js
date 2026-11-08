import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {normalizeSessionFocus,patchSessionFocus,saveSessionFocusPatch} from '../src/session-focus.js';
import {sessionFocusRect} from '../src/session-focus-layout.js';
import {calculatePokerWorkspace} from '../src/poker-workspace.js';
test('five plain-text prompts are bounded, persistent and patched without resetting other fields',()=>{
 const model=normalizeSessionFocus();assert.equal(model.enabled,true);assert.deepEqual(model.lines,['','','','','']);assert.equal(model.active,0);
 const next=patchSessionFocus(model,{lines:['A\nB',null,'<script>test</script>','x'.repeat(200),'五'],active:4,tableLayout:{enabled:false}});
 assert.equal(next.lines[0],'A B');assert.equal(next.lines[1],'');assert.equal(next.lines[3].length,160);assert.equal(next.lines[4],'五');
 assert.equal(next.lines[2],'<script>test</script>');assert.equal(next.active,4);assert.equal(next.tableLayout,undefined);
 assert.deepEqual(patchSessionFocus(next,{enabled:false}).lines,next.lines);assert.equal(normalizeSessionFocus({active:Infinity}).active,0);
 const edited=patchSessionFocus(next,{lineEdits:{1:'Only this row'}});assert.equal(edited.lines[0],next.lines[0]);assert.equal(edited.lines[1],'Only this row');assert.ok(edited.revision>next.revision);
});
test('atomic saves preserve unrelated settings and failed writes do not commit the draft',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'poker-focus-')),file=path.join(dir,'settings.json');
 const original={tableLayout:{enabled:true},comfort:{breakMinutes:50},sessionFocus:normalizeSessionFocus()};
 fs.writeFileSync(file,JSON.stringify(original));
 const saved=saveSessionFocusPatch(original,file,{lines:['Session drill'],active:2});
 assert.equal(original.sessionFocus.lines[0],'');assert.deepEqual(saved.tableLayout,original.tableLayout);
 assert.deepEqual(JSON.parse(fs.readFileSync(file)).sessionFocus,saved.sessionFocus);
 const before=fs.readFileSync(file,'utf8');
 assert.throws(()=>saveSessionFocusPatch(saved,file,{lines:['unsaved']},{writeFileSync(){throw Error('disk full');},renameSync(){throw Error('must not rename');}}));
 assert.equal(fs.readFileSync(file,'utf8'),before);
 assert.equal(saved.sessionFocus.lines[0],'Session drill');
 if(!path.resolve(dir).startsWith(path.join(path.resolve(os.tmpdir()),'poker-focus-')))throw Error('Unsafe temp cleanup');fs.rmSync(dir,{recursive:true});
});
const overlap=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
test('panel uses spare space at1–12 counts without changing a single table or utility rectangle',()=>{
 for(const scale of [1,1.25,1.5,2])for(let n=1;n<=12;n++){
  const work={x:-3840,y:31,width:3840,height:2112},plan=calculatePokerWorkspace(work,n,{automaticPolicy:true,scaleFactor:scale});
  if(plan.mode!=='full')continue;const before=structuredClone(plan);
  const r=sessionFocusRect(work,{tables:plan.tableRects,slots:plan.slots,actual:[],scaleFactor:scale});
  if(r){assert.ok(r.x>=work.x&&r.y>=work.y&&r.x+r.width<=work.x+work.width&&r.y+r.height<=work.y+work.height);for(const b of [...plan.tableRects,...Object.values(plan.slots)])assert.equal(overlap(r,b),false);}
  if(scale===1)assert.ok(r,'Expected spare focus area for '+n);
  assert.deepEqual(plan,before);
 }
});
test('legacy focus fallback stays below a compact clock, and drifted actual windows block placement',()=>{
 const work={x:0,y:0,width:3840,height:2112},plan=calculatePokerWorkspace(work,6,{automaticPolicy:true});
 plan.slots.clock={...plan.slots.clock,width:324,height:192};
 const rect=sessionFocusRect(work,{tables:plan.tableRects,slots:plan.slots,actual:[],scaleFactor:1});
 assert.equal(rect.x,plan.slots.clock.x);assert.equal(rect.y,plan.slots.clock.y+plan.slots.clock.height+8);
 const other=sessionFocusRect(work,{tables:plan.tableRects,slots:plan.slots,actual:[rect],scaleFactor:1});assert.ok(!other||!overlap(other,rect));
 assert.equal(sessionFocusRect(work,{tables:plan.tableRects,slots:plan.slots,actual:[work],scaleFactor:1}),null);
 assert.equal(sessionFocusRect(work,{tables:plan.tableRects,slots:plan.slots,actual:[{x:NaN}],scaleFactor:1}),null);
});
test('actual notes IPC rejects foreign senders and exposes only the focus model',()=>{
 const source=fs.readFileSync(new URL('../main.js',import.meta.url),'utf8'),handlers=new Map(),sender={},calls=[];
 const context=vm.createContext({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},sessionFocusPanel:{accepts:value=>value===sender},
  normalizeSessionFocus,settings:{sessionFocus:{lines:['My drill']},tableLayout:{enabled:true}},updateSessionFocus:patch=>calls.push(patch)});
 vm.runInContext(source.slice(source.indexOf('// Session focus IPC'),source.indexOf("ipcMain.handle('clock:get'")),context);
 assert.throws(()=>handlers.get('session-focus:get')({sender:{}}),/Unauthorized/);
 assert.throws(()=>handlers.get('session-focus:update')({sender:{}},{lines:['bad']}),/Unauthorized/);assert.equal(calls.length,0);
 const model=handlers.get('session-focus:get')({sender});assert.equal(model.lines[0],'My drill');assert.equal(model.tableLayout,undefined);
 handlers.get('session-focus:update')({sender},{active:2});assert.equal(calls.length,1);
});
