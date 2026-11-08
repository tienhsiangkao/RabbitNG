import test from "node:test";
import assert from "node:assert/strict";
import { TableLayoutManager } from "../src/table-layout-manager.js";
import { applyAutomaticDefaults } from '../src/automatic-defaults.js';
import {calculatePokerWorkspace} from '../src/poker-workspace.js';

function fakeMonitor(id, primary, workArea) {
  return {
    id,
    isValid: () => true,
    isPrimary: () => primary,
    getBounds: () => ({ ...workArea }),
    getWorkArea: () => ({ ...workArea }),
    getScaleFactor: () => 1
  };
}

function fakeWindow(id, bounds) {
  let current = { ...bounds };
  const moves = [];
  return {
    id,
    moves,
    getBounds: () => ({ ...current }),
    setBounds: (next) => {
      current = { ...current, ...next };
      moves.push({ ...current });
    }
  };
}

function enabledConfig(overrides = {}) {
  return {
    enabled: true,
    arrangeOnStartup: true,
    autoArrange: true,
    lockLayout: false,
    activeProfileId: "default",
    profiles: [{
      id: "default",
      name: "Default",
      monitorId: "primary",
      rows: 1,
      columns: 2,
      gap: 0,
      margin: 0
    }],
    ...overrides
  };
}

test('workspace executes exact selected targets in stake order instead of recomputing a square grid',()=>{
  const monitor=fakeMonitor(1,true,{x:0,y:0,width:3840,height:2112});
  let plan=calculatePokerWorkspace(monitor.getWorkArea(),6);
  const tables=Array.from({length:6},(_,i)=>({...fakeWindow(i+1,{x:70,y:50,width:800,height:600}),path:'C:\\test\\GGnet.exe',title:i===5?'NLH Gold 08':'Rush & Cash - $0.10 / $0.25'}));
  const manager=new TableLayoutManager({windowManager:{getMonitors:()=>[monitor]},getLayoutWorkArea:()=>plan.tableArea,getLayoutTargets:()=>plan.tableRects});
  const config=enabledConfig({profiles:[{id:'default',monitorId:'primary',rows:0,columns:0,gap:0,margin:0}]});
  assert.equal(manager.maybeArrange(tables,config),true);
  assert.deepEqual(tables[5].getBounds(),{x:0,y:0,width:985,height:704});
  assert.deepEqual(tables.slice(0,5).map(w=>w.getBounds()),plan.tableRects.slice(1));
  const moves=tables.map(w=>w.moves.length);
  plan=calculatePokerWorkspace(monitor.getWorkArea(),6);
  manager.maybeArrange(tables,config);assert.deepEqual(tables.map(w=>w.moves.length),moves);
});

test('a newly unavailable workspace never pulls tables into stale locked slots',()=>{
  const monitor=fakeMonitor(1,true,{x:0,y:0,width:3840,height:2112});
  let plan=calculatePokerWorkspace(monitor.getWorkArea(),4);
  const tables=Array.from({length:4},(_,i)=>({...fakeWindow(i+1,{x:0,y:0,width:800,height:600}),path:'C:\\test\\GGnet.exe'}));
  const manager=new TableLayoutManager({windowManager:{getMonitors:()=>[monitor]},getLayoutWorkArea:()=>plan.tableArea,getLayoutTargets:()=>plan.tableRects});
  const config=enabledConfig({lockLayout:true,profiles:[{id:'default',monitorId:'primary',rows:0,columns:0,gap:0,margin:0}]});
  manager.maybeArrange(tables,config);
  plan=calculatePokerWorkspace({x:0,y:0,width:1920,height:1040},4);
  tables[0].setBounds({x:60,y:80,width:800,height:600});const moves=tables.map(w=>w.moves.length);
  manager.maybeArrange(tables,config);
  manager.maybeArrange(tables,config);
  assert.deepEqual(tables.map(w=>w.moves.length),moves);
  plan=calculatePokerWorkspace(monitor.getWorkArea(),4);
  manager.maybeArrange(tables,config);assert.deepEqual(tables[0].getBounds(),plan.tableRects[0]);
});

test('changed exact targets trigger reflow even when their reserved work area stays the same',()=>{
  const monitor=fakeMonitor(1,true,{x:0,y:0,width:1600,height:900});
  let targets=[{x:0,y:0,width:700,height:500},{x:700,y:0,width:700,height:500}];
  const tables=[fakeWindow(1,{x:0,y:50,width:50,height:50}),fakeWindow(2,{x:0,y:100,width:50,height:50})];
  const manager=new TableLayoutManager({windowManager:{getMonitors:()=>[monitor]},getLayoutTargets:()=>targets});
  const config=enabledConfig();manager.maybeArrange(tables,config);
  targets=targets.map(r=>({...r,y:200}));manager.maybeArrange(tables,config);
  assert.deepEqual(tables.map(w=>w.getBounds()),targets);
});

test('invalid or explicitly refused targets never fall back to a different arrangement',()=>{
  for(const targets of [null,[],[{x:0,y:0,width:NaN,height:500}],
    [{x:1400,y:0,width:700,height:500}],
    [{x:0,y:0,width:700,height:500},{x:0,y:0,width:700,height:500}]]){
    const tables=Array.from({length:targets?.length||1},(_,i)=>fakeWindow(i+1,{x:30,y:40,width:300,height:200}));
    const manager=new TableLayoutManager({windowManager:{getMonitors:()=>[fakeMonitor(1,true,{x:0,y:0,width:1600,height:900})]},getLayoutTargets:()=>targets,error:()=>{}});
    assert.equal(manager.maybeArrange(tables,enabledConfig()),false);
    assert.ok(tables.every(w=>w.moves.length===0));
  }
});

test('exact workspace targets repair even one-pixel size and seam errors',()=>{
  const monitor=fakeMonitor(1,true,{x:0,y:0,width:1600,height:900});
  const targets=[{x:0,y:0,width:700,height:500},{x:700,y:0,width:700,height:500}];
  const tables=[fakeWindow(1,{x:0,y:0,width:701,height:500}),fakeWindow(2,{x:701,y:0,width:699,height:500})];
  const manager=new TableLayoutManager({windowManager:{getMonitors:()=>[monitor]},getLayoutTargets:()=>targets});
  const config=enabledConfig({lockLayout:true});manager.maybeArrange(tables,config);
  assert.deepEqual(tables.map(w=>w.getBounds()),targets);
  tables[0].setBounds({...targets[0],width:701});manager.maybeArrange(tables,config);
  assert.deepEqual(tables.map(w=>w.getBounds()),targets);
});

test('a disconnected selected monitor never restores stale locked coordinates',()=>{
  for(const autoArrange of [true,false]){
    let monitors=[fakeMonitor(1,true,{x:0,y:0,width:1600,height:900})];
    const tables=[fakeWindow(1,{x:40,y:50,width:600,height:400})];
    const manager=new TableLayoutManager({windowManager:{getMonitors:()=>monitors},error:()=>{}});
    const config=enabledConfig({autoArrange,lockLayout:true,profiles:[{id:'default',monitorId:'primary',rows:1,columns:1,gap:0,margin:0}]});
    manager.maybeArrange(tables,config);monitors=[];
    tables[0].setBounds({x:-1000,y:100,width:700,height:500});const moves=tables[0].moves.length;
    for(let i=0;i<4;i++)manager.maybeArrange(tables,config);
    assert.equal(tables[0].moves.length,moves);
    assert.deepEqual(tables[0].getBounds(),{x:-1000,y:100,width:700,height:500});
  }
});

test('unapplied profile geometry cannot change the workspace area or move tables',()=>{
  const monitor=fakeMonitor(1,true,{x:0,y:0,width:3840,height:2112});
  const tables=Array.from({length:4},(_,i)=>({...fakeWindow(i+1,{x:0,y:0,width:400,height:300}),path:'C:\\test\\GGnet.exe'}));
  const config=enabledConfig({profiles:[{id:'default',monitorId:'primary',rows:0,columns:0,gap:0,margin:0}]});
  let plan=calculatePokerWorkspace(monitor.getWorkArea(),4,{profile:config.profiles[0]});
  const manager=new TableLayoutManager({windowManager:{getMonitors:()=>[monitor]},getLayoutWorkArea:()=>plan.tableArea});
  manager.maybeArrange(tables,config);const original=tables.map(w=>w.getBounds());
  config.profiles[0].columns=6;
  const effective=manager.effectiveConfig?.(config)||config;
  plan=calculatePokerWorkspace(monitor.getWorkArea(),4,{profile:effective.profiles[0]});
  manager.maybeArrange(tables,config);
  assert.deepEqual(tables.map(w=>w.getBounds()),original);
});

test('reserved workspace bounds are used for arranging; unavailable bounds leave current tables untouched',()=>{
  const table={...fakeWindow(1,{x:100,y:100,width:800,height:600}),path:'C:\\test\\GGnet.exe'};
  let area={x:0,y:0,width:1000,height:800};
  const manager=new TableLayoutManager({windowManager:{getMonitors:()=>[fakeMonitor(1,true,{x:0,y:0,width:1600,height:900})]},getLayoutWorkArea:()=>area});
  const config=enabledConfig({profiles:[{id:'default',rows:0,columns:0,gap:0,monitorId:'primary'}]});
  manager.maybeArrange([table],config);assert.equal(table.getBounds().width,1000);
  const placed=table.getBounds();area=null;manager.requestApply();manager.maybeArrange([table],config);assert.deepEqual(table.getBounds(),placed);
});

test('GG automatic layout keeps content proportions on a wide main display and higher stakes left',()=>{
  const titles=['Rush & Cash - $0.05 / $0.10','NLH Gold 08','Rush & Cash - $0.10 / $0.25','NLH - $0.25 / $0.50'];
  const tables=titles.map((title,i)=>({...fakeWindow(i+1,{x:0,y:0,width:1916,height:1052}),path:'C:\\test\\GGnet.exe',getTitle:()=>title}));
  const manager=new TableLayoutManager({windowManager:{getMonitors:()=>[fakeMonitor(1,true,{x:0,y:0,width:3840,height:2112})]}});
  const config=enabledConfig({profiles:[{id:'default',monitorId:'primary',rows:0,columns:0,gap:8,margin:0}]});
  manager.maybeArrange(tables,config);
  assert.deepEqual(tables[1].getBounds(),{x:0,y:0,width:1472,height:1052});
  assert.deepEqual(tables[3].getBounds(),{x:0,y:1060,width:1472,height:1052});
  assert.deepEqual(tables[0].getBounds(),{x:1480,y:1060,width:1472,height:1052});
  const moves=tables.map(t=>t.moves.length);manager.maybeArrange(tables,config);
  assert.deepEqual(tables.map(t=>t.moves.length),moves,'unchanged scans must not resize tables repeatedly');
});

test('upgraded automatic layout stays on the current primary display across restarts and table changes',()=>{
  const titles=['Rush & Cash - $0.05 / $0.10','NLH Gold 08','Rush & Cash - $0.10 / $0.25','NLH - $0.25 / $0.50'];
  const tables=titles.map((_,i)=>({...fakeWindow(i+1,{x:-1200,y:50,width:300,height:200}),getTitle:()=>titles[i]}));
  const config=applyAutomaticDefaults({comfortDefaultsVersion:2,tableLayout:enabledConfig({profiles:[{id:'default',monitorId:'monitor:42',rows:2,columns:2,gap:0,margin:0}]})}).tableLayout;
  let monitors=[fakeMonitor(42,false,{x:-1600,y:0,width:1600,height:900}),fakeMonitor(7,true,{x:0,y:0,width:1200,height:800})];
  const start=()=>new TableLayoutManager({windowManager:{getMonitors:()=>monitors}});
  let manager=start();
  assert.equal(manager.maybeArrange(tables,config),true);
  assert.deepEqual(tables.map(t=>[t.getBounds().x,t.getBounds().y]),[[600,400],[0,0],[600,0],[0,400]]);
  titles[0]='Rush & Cash - $5 / $10';
  manager.maybeArrange(tables,config);
  assert.deepEqual(tables[0].getBounds(),{x:0,y:0,width:600,height:400});
  tables.pop();manager.maybeArrange(tables,config);
  assert.ok(tables.every(t=>t.getBounds().x>=0&&t.getBounds().x+t.getBounds().width<=1200));
  // Windows may assign a different native handle to the main monitor later.
  monitors=[fakeMonitor(42,false,{x:-1600,y:0,width:1600,height:900}),fakeMonitor(88,true,{x:0,y:0,width:1000,height:700})];
  manager=start();manager.maybeArrange(tables,config);
  assert.ok(tables.every(t=>t.getBounds().x>=0&&t.getBounds().x+t.getBounds().width<=1000));
  assert.equal(tables[0].getBounds().x,0);
});

test('higher stakes fill the left column first; manual mode leaves later stake changes alone', () => {
  const titles=['Rush & Cash - $0.10 / $0.25','NLH Gold 08','NLH - $0.05 / $0.10','NLH - $0.10 / $0.25'];
  const tables=titles.map((title,i)=>({...fakeWindow(i+1,{x:0,y:0,width:300,height:200}),getTitle:()=>titles[i]}));
  const manager=new TableLayoutManager({windowManager:{getMonitors:()=>[fakeMonitor(1,true,{x:0,y:0,width:1200,height:800})]}});
  const config=enabledConfig({autoArrange:false,arrangeOnStartup:false,profiles:[{id:'default',monitorId:'primary',rows:2,columns:2,gap:0,margin:0}]});
  assert.equal(manager.maybeArrange(tables,config),false);
  manager.requestApply(); manager.maybeArrange(tables,config);
  assert.deepEqual(tables.map(t=>[t.getBounds().x,t.getBounds().y]),[[0,400],[0,0],[600,400],[600,0]]);
  titles[2]='NLH - $10 / $20';
  assert.equal(manager.maybeArrange(tables,config),false);
  assert.equal(tables[2].getBounds().x,600);
});

test('automatic mode starts without a button and reorders only on actual stake changes',()=>{
  const titles=['Rush & Cash - $0.10 / $0.25','NLH Gold 08'];
  const tables=titles.map((_,i)=>({...fakeWindow(i+1,{x:100+i*100,y:50,width:300,height:200}),getTitle:()=>titles[i]}));
  const manager=new TableLayoutManager({windowManager:{getMonitors:()=>[fakeMonitor(1,true,{x:0,y:0,width:1200,height:800})]}});
  const config=enabledConfig({arrangeOnStartup:false});
  assert.equal(manager.maybeArrange(tables,config),true);
  assert.equal(tables[1].getBounds().x,0);assert.equal(tables[0].getBounds().x,600);
  assert.equal(manager.maybeArrange(tables,config),false);
  titles[0]='Rush & Cash - $5 / $10';
  assert.equal(manager.maybeArrange(tables,config),true);
  assert.equal(tables[0].getBounds().x,0);assert.equal(tables[1].getBounds().x,600);
  titles[0]='Rush & Cash - $5 / $10 [6]';
  assert.equal(manager.maybeArrange(tables,config),false,'cosmetic title changes must not cause table movement');
});

test('incomplete grids fill every left-column slot before using the next column',()=>{
  for(const [rows,columns,count] of [[3,3,4],[3,2,5]]) {
    const tables=Array.from({length:count},(_,i)=>fakeWindow(i+1,{x:0,y:0,width:10,height:10}));
    const manager=new TableLayoutManager({windowManager:{getMonitors:()=>[fakeMonitor(1,true,{x:0,y:0,width:columns*300,height:rows*300})]}});
    manager.apply(tables,enabledConfig({profiles:[{id:'default',monitorId:'primary',rows,columns,gap:0,margin:0}]}));
    assert.deepEqual(tables.map(w=>[w.getBounds().x,w.getBounds().y]),tables.map((_,i)=>[Math.floor(i/rows)*300,(i%rows)*300]));
  }
});

test("TableLayoutManager arranges tables and restores their original bounds", () => {
  const first = fakeWindow(1, { x: 20, y: 20, width: 400, height: 300 });
  const second = fakeWindow(2, { x: 40, y: 40, width: 400, height: 300 });
  const manager = new TableLayoutManager({
    windowManager: {
      getMonitors: () => [fakeMonitor(10, true, { x: 0, y: 0, width: 1200, height: 800 })],
      getWindows: () => [first, second]
    }
  });

  assert.equal(manager.maybeArrange([first, second], enabledConfig()), true);
  assert.deepEqual(first.getBounds(), { x: 0, y: 0, width: 600, height: 800 });
  assert.deepEqual(second.getBounds(), { x: 600, y: 0, width: 600, height: 800 });

  assert.equal(manager.restore("test"), 2);
  assert.deepEqual(first.getBounds(), { x: 20, y: 20, width: 400, height: 300 });
  assert.deepEqual(second.getBounds(), { x: 40, y: 40, width: 400, height: 300 });
});

test("TableLayoutManager only reflows unchanged tables when layout locking is enabled", () => {
  const first = fakeWindow(1, { x: 0, y: 0, width: 300, height: 300 });
  const second = fakeWindow(2, { x: 300, y: 0, width: 300, height: 300 });
  const manager = new TableLayoutManager({
    windowManager: {
      getMonitors: () => [fakeMonitor(10, true, { x: 0, y: 0, width: 600, height: 300 })],
      getWindows: () => [first, second]
    }
  });

  manager.maybeArrange([first, second], enabledConfig());
  assert.equal(manager.maybeArrange([first, second], enabledConfig()), false);

  first.setBounds({ x: 25 });
  assert.equal(manager.maybeArrange([first, second], enabledConfig()), false);
  assert.equal(first.getBounds().x, 25);

  assert.equal(
    manager.maybeArrange([first, second], enabledConfig({ lockLayout: true })),
    true
  );
  assert.equal(first.getBounds().x, 0);
});

test("TableLayoutManager leaves tables alone when a saved monitor is unavailable", () => {
  const table = fakeWindow(1, { x: -500, y: 0, width: 300, height: 300 });
  const manager = new TableLayoutManager({
    windowManager: {
      getMonitors: () => [fakeMonitor(10, true, { x: 0, y: 0, width: 1000, height: 700 })],
      getWindows: () => [table]
    }
  });
  const config = enabledConfig({
    profiles: [{
      id: "default",
      name: "Missing monitor",
      monitorId: "monitor:999",
      rows: 1,
      columns: 1,
      gap: 0,
      margin: 0
    }]
  });

  manager.maybeArrange([table], config);
  assert.deepEqual(table.getBounds(), { x: -500, y: 0, width: 300, height: 300 });
});

function setup(overrides = {}) {
  const table = fakeWindow(1, { x: 50, y: 40, width: 300, height: 200 });
  const windows = [table];
  const manager = new TableLayoutManager({ windowManager: {
    getMonitors: () => [fakeMonitor(10, true, { x: 0, y: 0, width: 1000, height: 700 })],
    getWindows: () => windows,
  } });
  const config = enabledConfig({ autoArrange:false, arrangeOnStartup: false, ...overrides });
  return { table, windows, manager, config };
}

test('startup and repeated scans preserve current positions, even with locking saved', () => {
  const { table, windows, manager, config } = setup({ lockLayout: true });
  for (let i = 0; i < 3; i++) assert.equal(manager.maybeArrange(windows, config), false);
  assert.equal(table.moves.length, 0);
  manager.requestApply();
  assert.equal(manager.maybeArrange(windows, config), true);
  table.setBounds({ x: 90 });
  assert.equal(manager.maybeArrange(windows, config), true);
  assert.equal(table.getBounds().x, 0);
});

test('saving profile changes never rearranges until explicitly applied', () => {
  const { table, windows, manager, config } = setup();
  manager.maybeArrange(windows, config);
  config.profiles[0].columns = 3;
  manager.maybeArrange(windows, config);
  assert.equal(table.moves.length, 0);
  manager.requestApply(); manager.maybeArrange(windows, config);
  assert.equal(table.getBounds().width, 334);
});

test('automatic reflow starts immediately and handles tables opening and closing', () => {
  const { windows, manager, config, table } = setup({autoArrange:true});
  assert.equal(manager.maybeArrange(windows, config),true);
  windows.push(fakeWindow(2, { x: 600, y: 50, width: 300, height: 200 }));
  assert.equal(manager.maybeArrange(windows, config), true);
  windows.push(fakeWindow(3, { x: 700, y: 100, width: 300, height: 200 }));
  assert.equal(manager.maybeArrange(windows, config), true);
  assert.equal(table.getBounds().width, 500);
  windows.pop();assert.equal(manager.maybeArrange(windows,config),true);
});

test('stop preserves current positions by default, restoration is opt-in', () => {
  for (const restoreOnStop of [false, true]) {
    const { windows, manager, config, table } = setup({ restoreOnStop });
    const original = table.getBounds();
    manager.requestApply(); manager.maybeArrange(windows, config);
    const arranged = table.getBounds();
    manager.stop(config, 'quit');
    assert.deepEqual(table.getBounds(), restoreOnStop ? original : arranged);
    assert.equal(manager.assignedBounds.size, 0);
  }
});

test('mixed-DPI layouts convert native window logical bounds to physical monitor targets', () => {
  let physical = { x: 0, y: 0, width: 600, height: 400 };
  const scale = () => physical.x < 0 ? 1.5 : 2;
  const table = { id: 1, getMonitor: () => ({ getScaleFactor: scale }),
    getBounds: () => Object.fromEntries(Object.entries(physical).map(([key, value]) => [key, value / scale()])),
    setBounds: (logical) => { const factor = scale(); physical = Object.fromEntries(Object.entries(logical).map(([key, value]) => [key, value * factor])); },
  };
  const original = { ...physical };
  const manager = new TableLayoutManager({ windowManager: {
    getWindows: () => [table], getMonitors: () => [fakeMonitor(10, true, { x: -1500, y: 0, width: 1500, height: 900 })],
  } });
  manager.apply([table], enabledConfig({ profiles: [{ id: 'default', rows: 1, columns: 1, monitorId: 'primary' }] }));
  assert.deepEqual(physical, { x: -1500, y: 0, width: 1500, height: 900 });
  assert.equal(manager.hasDrift([table]), false);
  manager.restore(); assert.deepEqual(physical, original);
});

test('locking restores only assigned slots without applying pending edits or touching new tables', () => {
  const { table, windows, manager, config } = setup({ autoArrange: false, lockLayout: true });
  manager.requestApply(); manager.maybeArrange(windows, config);
  const assigned = table.getBounds();
  config.profiles[0].columns = 3;
  const added = fakeWindow(2, { x: 700, y: 70, width: 200, height: 150 });
  windows.push(added);
  table.setBounds({ x: 99 });
  manager.maybeArrange(windows, config);
  assert.deepEqual(table.getBounds(), assigned);
  assert.equal(added.moves.length, 0);
});

test('automatic reflow uses the applied profile rather than unapplied saved edits', () => {
  const { windows, manager, config, table } = setup({autoArrange:true});
  manager.requestApply(); manager.maybeArrange(windows, config);
  config.profiles[0].columns = 3;
  windows.push(fakeWindow(2, { x: 700, y: 50, width: 200, height: 150 }));
  manager.maybeArrange(windows, config);
  assert.equal(table.getBounds().width, 500);
});
