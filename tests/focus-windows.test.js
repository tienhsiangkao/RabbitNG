import test from 'node:test';
import assert from 'node:assert/strict';
import { FocusWindows } from '../src/focus-windows.js';

function harness() {
  const windows=new Map(Array.from({length:5},(_,i)=>[i+1,{id:i+1,pid:100+i,path:`app${i}.exe`,visible:true,minimized:false,eligible:true,owner:0,placement:{x:i*20,y:30,width:800,height:600,maximized:i===1}}]));
  const calls=[];let journal=[];const tags=new Map();
  const adapter={list:()=>[...windows.values()],inspect:w=>windows.get(w.id),tag:(w,cookie)=>{tags.set(w.id,cookie);return true;},hasTag:(w,cookie)=>tags.get(w.id)===cookie,
    untag:w=>tags.delete(w.id),minimize:w=>{calls.push(['minimize',w.id]);windows.get(w.id).minimized=true;return true;},
    restore:(w,placement)=>{calls.push(['restore',w.id]);Object.assign(windows.get(w.id),{minimized:false,placement});return true;}};
  const options={adapter,isProtected:w=>w.id===3,save:entries=>{journal=structuredClone(entries);},cookie:123};
  return {windows,calls,tags,adapter,options,getJournal:()=>journal,make:()=>new FocusWindows(options)};
}
test('focus minimizes eligible unrelated windows once and restores exact normal/maximized placements',()=>{
  const h=harness();h.windows.get(4).minimized=true;h.windows.get(5).eligible=false;
  const f=h.make();f.enter();f.enter();
  assert.deepEqual(h.calls,[['minimize',1],['minimize',2]]);assert.equal(h.getJournal().length,2);
  f.restore();assert.deepEqual(h.calls.slice(2),[['restore',2],['restore',1]]);
  assert.equal(h.windows.get(2).placement.maximized,true);assert.equal(h.windows.get(4).minimized,true);
  assert.equal(h.getJournal().length,0);
});
test('protected owner chains remain visible',()=>{
  const h=harness();h.windows.get(3).owner=1;h.windows.get(1).owner=2;
  h.make().enter();assert.deepEqual(h.calls,[['minimize',4],['minimize',5]]);
});
test('visible modal dialogs protect their unrelated owner chains',()=>{
  const h=harness();Object.assign(h.windows.get(4),{owner:1,eligible:false,protectOwner:true});
  h.make().enter();assert.deepEqual(h.calls,[['minimize',2],['minimize',5]]);
});
test('manual reopening and reused handles are not overwritten on restore',()=>{
  const h=harness(),f=h.make();f.enter();
  h.windows.get(1).minimized=false;
  h.windows.set(2,{...h.windows.get(2),pid:999});h.tags.delete(4);
  f.restore();assert.deepEqual(h.calls.filter(c=>c[0]==='restore'),[['restore',5]]);
});
test('journal is written before minimizing and write/native failures do not strand windows',()=>{
  const h=harness();let writes=0;
  h.options.save=()=>{writes++;throw new Error('Disk unavailable');};
  assert.throws(()=>h.make().enter(),/Disk unavailable/);assert.equal(writes,1);assert.equal(h.calls.length,0);assert.equal(h.tags.size,0);
  const h2=harness();h2.adapter.minimize=()=>false;h2.make().enter();assert.equal(h2.getJournal().length,0);assert.equal(h2.tags.size,0);
});
test('restart recovery restores only still-matching minimized windows',()=>{
  const h=harness();h.make().enter();const saved=h.getJournal();
  h.windows.get(1).minimized=false;
  const recovered=h.make();recovered.restore(saved);
  assert.deepEqual(h.calls.filter(c=>c[0]==='restore'),[['restore',5],['restore',4],['restore',2]]);
  assert.equal(h.getJournal().length,0);
});
test('failed restores stay journaled and retain the tag for retry',()=>{
  const h=harness(),f=h.make();f.enter();
  h.adapter.restore=()=>false;f.restore();assert.equal(h.getJournal().length,4);assert.equal(h.tags.size,4);
});
test('interrupted startup recovery retains its journal and retries before a new focus pass',()=>{
  const h=harness();h.make().enter();const saved=h.getJournal(),recover=h.make();
  const list=h.adapter.list;h.adapter.list=()=>{throw new Error('Enumeration failed');};
  assert.throws(()=>recover.restore(saved),/Enumeration failed/);
  assert.equal(recover.entries.length,4);assert.equal(h.getJournal().length,4);
  assert.throws(()=>recover.enter(),/Enumeration failed/);assert.equal(h.calls.filter(c=>c[0]==='minimize').length,4);
  h.adapter.list=list;recover.restore();assert.equal(recover.entries.length,0);assert.equal(h.getJournal().length,0);
});
test('a failed per-window tag check retains the unresolved entry and restores other windows',()=>{
  const h=harness(),f=h.make();f.enter();const hasTag=h.adapter.hasTag;
  h.adapter.hasTag=(w,cookie)=>{if(w.id===2)throw new Error('Temporary native read failure');return hasTag(w,cookie);};
  f.restore();assert.deepEqual(h.getJournal().map(e=>e.id),[2]);
  h.adapter.hasTag=hasTag;f.restore();assert.equal(h.getJournal().length,0);
});
