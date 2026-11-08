import fs from 'node:fs';
import path from 'node:path';
import Module,{createRequire,syncBuiltinESMExports} from 'node:module';
import childProcess from 'node:child_process';
import {createSimulationModel} from './simulation-model.js';
import {createHiddenSimulationBrowserWindow} from './simulation-browser-window.js';
import {installSimulationGuards} from './simulation-guards.js';
import {publishSimulationReport} from './simulation-profile.js';
const require=createRequire(import.meta.url);
const near=(a,b,t=.001)=>a&&b&&['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<=t);
export function recordSimulationRngCommit(owned,commits,sender,commit){
 if(![...owned.values()].some(r=>r.contentsId===sender.id&&!r.win.isDestroyed()))return false;
 commits.set(sender.id,{...commit});return true;
}
export function createSimulationRuntime(electron,config){
 const {app,session}=electron,model=createSimulationModel(),owned=new Map();
 const calls=installSimulationGuards({Module,childProcess,syncBuiltinESMExports});
 let nextId=10000000,blockedRequests=0,actualShowEvents=0,sessionState;
 const commits=new Map();
 const stages=[],started=Date.now(),reportFile=path.join(config.directory,'report.json');
 const settings=JSON.parse(fs.readFileSync(path.join(app.getAppPath(),'settings.json'),'utf8'));
 settings.autoStartEnabled=false;settings.comfortDefaultsVersion=4;settings.thinBorderDefaultsVersion=1;
 settings.workspace={enabled:true};settings.comfort={clockMode:'shared',breakEnabled:true,breakMinutes:50};
 settings.tableLayout={enabled:true,autoArrange:true,lockLayout:false,arrangeOnStartup:true,restoreOnStop:false,
  activeProfileId:'automatic',profiles:[{id:'automatic',name:'Simulation',monitorId:'primary',rows:0,columns:0,gap:0,margin:0}]};
 settings.scanMs=120;settings.quietMode=true;settings.showOnlyActiveTables=false;
 settings.overlays={...settings.overlays,buyInEnabled:true,clockEnabled:true,stakeFrameEnabled:true};
 fs.writeFileSync(path.join(config.directory,'settings.json'),JSON.stringify(settings,null,2));
 const BrowserWindow=createHiddenSimulationBrowserWindow(electron.BrowserWindow,(win,details)=>{
  const id=nextId++,buffer=Buffer.alloc(8);buffer.writeBigUInt64LE(BigInt(id));
  win.getNativeWindowHandle=()=>buffer;
  win.on('show',()=>{actualShowEvents++;finish(false,new Error('A real simulation window was shown'));});
  win.webContents.on('render-process-gone',(_,info)=>{finish(false,new Error('Renderer exited: '+JSON.stringify(info)));});
  owned.set(id,{win,contentsId:win.webContents.id,...details});win.on('closed',()=>owned.delete(id));
 });
 model.registerOwnWindows(()=>[...owned].filter(([,r])=>!r.win.isDestroyed()).map(([id,{win}])=>({
  id,processId:process.pid,path:process.execPath,getTitle:()=>win.getTitle(),getBounds:()=>win.getBounds(),
  getMonitor:()=>model.windowManager.getMonitors()[0],isVisible:()=>win.isVisible(),isMinimized:()=>false,
  isWindow:()=>!win.isDestroyed(),getClassName:()=> 'Chrome_WidgetWin_1'})));
 let finished=false,timer;
 function finish(ok,error){
  if(finished)return;finished=true;clearTimeout(timer);
  const loadedNative=Object.keys(require.cache).filter(p=>/[\\/](koffi|node-window-manager|extract-file-icon)[\\/]/i.test(p));
  const actualVisible=[...owned.values()].filter(r=>!r.win.isDestroyed()&&r.actualVisible()).length;
  const safe=loadedNative.length===0&&calls.nativeModuleAttempts===0&&calls.childCommandAttempts===0&&actualVisible===0&&actualShowEvents===0;
  const report={status:ok&&safe?'passed':'failed',startedAt:new Date(started).toISOString(),finishedAt:new Date().toISOString(),
   profile:config.directory,stages,calls,loadedNative,actualVisibleWindows:actualVisible,actualShowEvents,blockedRequests,
   hardwareAccelerationDisabled:true,realAppEntrypoint:true,realLocalRenderers:true,syntheticWindowBackend:true,
   error:error?String(error.stack||error):safe?null:'Simulation boundary failed',
   limits:['No real GG or desktop window metadata queried','Window visibility/geometry are simulated','Native transparency, z-order, GG behavior and historical closures are not verified']};
  let exitCode=1;
  try{publishSimulationReport(config.directory,report);if(report.status==='passed')exitCode=0;}
  catch(writeError){console.error('[simulation report]',writeError);}
  finally{app.exit(exitCode);}
 }
 process.on('uncaughtException',error=>finish(false,error));
 process.on('unhandledRejection',error=>finish(false,error instanceof Error?error:new Error(String(error))));
 timer=setTimeout(()=>finish(false,new Error('Simulation deadline exceeded')),config.timeoutMs);
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 const check=(value,message)=>{if(!value)throw new Error(message);};
 function diagnostics(){try{return JSON.parse(fs.readFileSync(path.join(config.directory,'frame-status.json'),'utf8'));}catch{return null;}}
 async function until(predicate,message){
  while(!finished){const result=await predicate();if(result)return result;if(Date.now()-started>config.timeoutMs-1000)throw new Error(message);await delay(60);}
  throw new Error('Simulation ended before '+message);
 }
 function tableMoves(){return model.moves.filter(m=>model.tables.some(w=>w.id===m.id)).length;}
 function visibleFrames(){return [...owned.values()].filter(r=>!r.win.isDestroyed()&&r.win.getTitle()==='Poker Stake Frame'&&r.win.isVisible()).length;}
 function geometryCheck(plan,count=6){
  check(plan?.tableRects?.length===count,'Expected '+count+' table slots');
  const slots=new Set(plan.tableRects.map(r=>JSON.stringify(r)));check(slots.size===count,'Duplicate table slots');
  for(const win of model.tables.filter(w=>w.visible&&w.alive&&!w.minimized&&!w.cloaked)){const key=JSON.stringify(win.physicalBounds());check(slots.delete(key),'Table does not occupy a distinct planned slot');}
  check(slots.size===0,'Not every slot is occupied');
  for(const [id,role]of [[101,'challenge'],[102,'notes'],[103,'replay']]){
   check(near(model.fixtures.find(w=>w.id===id).physicalBounds(),plan.slots[role],Math.max(2,model.scale)),'Utility differs from planned '+role+' slot');
  }
 }
 async function rendererChecks(count=6){
  const windows=[...owned.values()].map(r=>r.win).filter(w=>!w.isDestroyed());
  const numbers=windows.filter(w=>w.getTitle()==='Poker RNG'&&w.isVisible());
  check(numbers.length===count,'Expected '+count+' logically visible RNG renderers');
  const values=[];
  for(const win of numbers){
   const metrics=await until(async()=>{
    const m=await win.webContents.executeJavaScript(`(()=>{const n=document.getElementById('num'),r=n.getBoundingClientRect(),c=document.querySelector('.card').getBoundingClientRect(),digits=Array.from(n.children).map(el=>el.textContent).join('');return {digits,value:Number(digits),rolling:n.classList.contains('rolling'),fits:r.width>0&&r.height>0&&c.width>0&&c.height>0&&r.left>=c.left-1&&r.top>=c.top-1&&r.right<=c.right+1&&r.bottom<=c.bottom+1,width:innerWidth,height:innerHeight};})()`);
    const committed=commits.get(win.webContents.id);
    return !m.rolling&&/^\d{2}$/.test(m.digits)&&committed?.rollId>0&&committed.value===m.value?{...m,committed}:null;
   },'authoritative RNG renderer commit');
   check(metrics.fits,'RNG text is clipped by its card');values.push(metrics);
  }
  const clock=windows.find(w=>w.getTitle()==='Poker Session Clock'&&w.isVisible());check(clock,'Shared clock missing');
  const clockMetrics=await clock.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.clock,.clock-utc')).map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,centered:getComputedStyle(el).textAlign==='center',fits:r.width>0&&r.height>0&&el.scrollWidth<=el.clientWidth+1&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};})`);
  check(clockMetrics.length===2&&clockMetrics.every(r=>r.centered&&r.fits&&/\d{2}:\d{2}:\d{2}/.test(r.text)),'Clock rows empty, clipped or not centered');
  return {rng:values,clock:clockMetrics};
 }
 return {BrowserWindow,windowManager:model.windowManager,workspaceAdapter:model.workspaceAdapter,
  readDisplayState:model.readDisplayState,screen:model.screen,
  globalShortcut:{register:()=>true,unregisterAll(){}},focusAdapter:{list:()=>[],inspect:()=>null},
  initialize(){session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_,callback)=>{blockedRequests++;callback({cancel:true});});},
  recordRngCommit:(sender,commit)=>recordSimulationRngCommit(owned,commits,sender,commit),
  registerComfortSession:state=>{sessionState=state;},
  async run(){
   try{
    await app.whenReady();
    let d=await until(()=>{
     const f=diagnostics();
     return f?.workspace?.tableRects?.length===6&&f.frames?.length===6&&f.frames.every(r=>r.visible&&r.drawn?.painted)?f:null;
    },'settled six-table layout and ready overlay renderers');
    const original=model.tables.map(w=>w.physicalBounds());
    geometryCheck(d.workspace);
    await delay(500);stages.push({name:'startup-and-renderers',passed:true,metrics:await rendererChecks(),tableBounds:original});
    const focus=await until(()=>[...owned.values()].map(r=>r.win).find(w=>!w.isDestroyed()&&w.getTitle()==='Poker Session Focus'&&w.isVisible()),'session focus panel in spare space');
    const focusWrites=model.moves.length;
    await focus.webContents.executeJavaScript('document.getElementById("library").click()');
    await focus.webContents.executeJavaScript('document.getElementById("edit").click()');
    await focus.webContents.executeJavaScript(`(()=>{document.querySelectorAll('textarea').forEach((el,i)=>{el.value='Practice prompt '+(i+1);el.dispatchEvent(new Event('input',{bubbles:true}));});})()`);
    await until(()=>{
     try{return JSON.parse(fs.readFileSync(path.join(config.directory,'settings.json'),'utf8')).sessionFocus?.lines?.[4]==='Practice prompt 5';}catch{return false;}
    },'five prompts persisted in isolated profile');
    await focus.webContents.executeJavaScript('document.getElementById("edit").click()');
    await until(async()=>await focus.webContents.executeJavaScript('document.querySelectorAll(".line").length===5'),'session focus read mode');
    await focus.webContents.executeJavaScript('document.querySelectorAll(".line")[2].click()');
    await until(async()=>await focus.webContents.executeJavaScript('window.sessionFocus.get().then(s=>s.active===2)'),'focus highlight saved');
    check(model.moves.length===focusWrites,'Editing focus notes moved a table or native utility');
    stages.push({name:'session-focus-notebook',passed:true,prompts:5,highlight:true,nativeWrites:0});
    const clock=[...owned.values()].map(r=>r.win).find(w=>!w.isDestroyed()&&w.getTitle()==='Poker Session Clock');
    const control=await clock.webContents.executeJavaScript(`(()=>{const b=document.getElementById('toggle-playing'),r=b.getBoundingClientRect();return {enabled:!b.disabled,region:getComputedStyle(b).webkitAppRegion,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b};})()`);
    check(control.enabled&&control.region==='no-drag'&&control.hit,'Normal Start Play control is not an enabled button hit target');
    await clock.webContents.executeJavaScript("document.getElementById('toggle-playing').click()");
    await until(()=>diagnostics()?.session?.playing===true,'Start Play IPC session transition');
    await until(async()=>await clock.webContents.executeJavaScript("document.getElementById('toggle-playing').textContent==='Pause'"),'Start Play renderer feedback');
    await clock.webContents.executeJavaScript("document.getElementById('toggle-playing').click()");
    await until(()=>diagnostics()?.session?.playing===false,'Pause IPC session transition');
    stages.push({name:'normal-start-pause-controls',passed:true,control,nativeFocusAdapter:'synthetic only'});
    check(sessionState,'Real session model was not registered');
    await until(async()=>await clock.webContents.executeJavaScript("document.getElementById('toggle-playing').textContent!=='Pause'"),'paused clock before break-cycle test');
    await clock.webContents.executeJavaScript("document.getElementById('toggle-playing').click()");
    await until(()=>sessionState.playing===true,'playing before timed break');
    sessionState.elapsed=3000000;sessionState.breakAt=0;sessionState.snoozeUntil=0;
    await until(async()=>await clock.webContents.executeJavaScript("!document.getElementById('break-status').hidden&&!document.getElementById('clock-break').hidden"),'50-minute break cue');
    check(sessionState.playing,'Break-cycle test must start from Playing');
    await clock.webContents.executeJavaScript("document.getElementById('clock-break').click()");
    await until(async()=>await clock.webContents.executeJavaScript("window.clockComfort.get().then(s=>s.breakActive&&!s.playing&&s.breakRemainingSeconds>590&&s.seconds>=3000&&s.seconds<3005)"),'ten-minute paused break');
    sessionState.breakUntil=Date.now()-1000;
    await until(async()=>await clock.webContents.executeJavaScript("window.clockComfort.get().then(s=>s.breakReady&&!s.playing)"),'completed break without auto-resume');
    await until(async()=>await clock.webContents.executeJavaScript("document.getElementById('break-message').textContent.includes('Break finished')"),'finished-break UI');
    await clock.webContents.executeJavaScript("document.getElementById('toggle-playing').click()");
    await until(async()=>await clock.webContents.executeJavaScript("window.clockComfort.get().then(s=>s.playing&&!s.breakReady&&!s.breakDue&&s.seconds>=3000)"),'manual Resume starts next work interval');
    await until(async()=>await clock.webContents.executeJavaScript("document.getElementById('toggle-playing').textContent==='Pause'"),'resumed clock feedback');
    await clock.webContents.executeJavaScript("document.getElementById('toggle-playing').click()");
    await until(()=>sessionState.playing===false,'pause after break-cycle test');sessionState.reset();
    stages.push({name:'fifty-ten-break-cycle',passed:true,workCountedMinutes:50,breakWallMinutes:10,automaticResume:false});
    const stableTableWrites=tableMoves(),stableTableBounds=model.tables.map(w=>w.physicalBounds());
    model.tables[0].minimized=true;model.tables[1].cloaked=true;
    await until(()=>visibleFrames()===4,'minimized and cloaked overlays hidden');
    d=await until(()=>{const f=diagnostics(),rows=f?.stability?.windows;return rows?.some(r=>r.id===1&&r.minimized&&!r.visible)&&rows.some(r=>r.id===2&&!r.visible)?f:null;},'visibility metadata journal');
    check(tableMoves()===stableTableWrites,'Minimize/cloak moved tables');
    model.tables[0].minimized=false;model.tables[1].cloaked=false;
    await until(()=>visibleFrames()===6,'minimized/cloaked table overlays return');
    check(model.tables.every((w,i)=>near(w.physicalBounds(),stableTableBounds[i])),'Minimize/cloak changed slots');
    stages.push({name:'minimize-cloak-metadata',passed:true,tableWrites:tableMoves()-stableTableWrites,
     observedMetadata:true,events:d.stability.events.length});
    const notes=model.fixtures.find(w=>w.id===102),noteTarget={...d.workspace.slots.notes};
    notes.setPhysicalBounds({...noteTarget,x:40});
    await until(()=>near(notes.physicalBounds(),noteTarget),'utility magnetic return after drift');
    notes.visible=false;await delay(400);notes.visible=true;
    await until(()=>near(notes.physicalBounds(),noteTarget),'utility visible return');
    check(tableMoves()===stableTableWrites,'Utility changes moved tables');
    d=await until(()=>{const f=diagnostics();return f?.stability?.events.some(e=>e.type==='window-changed'&&e.after?.id===102)?f:null;},'utility metadata events');
    check(d.stability.events.length<=200&&d.stability.windows.length<=128,'Metadata journal exceeded bounds');
    stages.push({name:'utility-drift-and-return',passed:true,tableWrites:0,boundedMetadata:true});
    const before=tableMoves();model.tables[4].visible=false;model.tables[5].visible=false;
    await until(()=>visibleFrames()===4,'four visible overlays');
    check(tableMoves()===before,'Hiding two tables moved survivors');
    stages.push({name:'hide-two',passed:true,tableWrites:tableMoves()-before});
    model.tables.forEach(w=>{w.visible=false;});
    await until(()=>visibleFrames()===0,'zero visible overlays');
    model.tables[0].setPhysicalBounds({x:20,y:20,width:600,height:500});model.tables.forEach(w=>{w.visible=true;});
    await until(()=>near(model.tables[0].physicalBounds(),original[0])&&visibleFrames()===6,'restored six slots');
    check(model.tables.every((w,i)=>near(w.physicalBounds(),original[i])),'Restored slot changed');
    stages.push({name:'hide-all-and-return',passed:true,tableWrites:tableMoves()-before});
    model.setScale(1.25);
    d=await until(()=>{const f=diagnostics();return f?.workspace?.scaleFactor===1.25&&f.frames.length===6&&f.frames.every(r=>r.visible&&r.drawn?.painted)?f:null;},'125% virtual display reflow');
    await delay(700);const stableWrites=tableMoves();await delay(700);
    check(tableMoves()===stableWrites,'Unchanged fractional-DPI scans repeatedly moved tables');
    geometryCheck(d.workspace);
    stages.push({name:'virtual-125-percent',passed:true,metrics:await rendererChecks(),tableBounds:model.tables.map(w=>w.physicalBounds())});
    const prior=model.tables.map(w=>w.physicalBounds()),extra=model.addTable();await delay(700);
    check(model.tables.every((w,i)=>near(w.physicalBounds(),prior[i])),'Seventh table shifted reserved owners');
    check(!model.moves.some(m=>m.id===extra.id),'Unassigned seventh window was moved');
    stages.push({name:'seventh-table',passed:true,tableWrites:0});
    extra.alive=false;
    model.tables[4].visible=false;model.tables[5].visible=false;
    const hiddenBounds=model.tables.slice(4).map(w=>w.physicalBounds());
    d=await until(()=>{const f=diagnostics();return f?.workspace?.tableRects?.length===4&&visibleFrames()===4?f:null;},'settled six-to-four layout');
    const fourSlots=new Set(d.workspace.tableRects.map(r=>JSON.stringify(r)));
    for(const win of model.tables.slice(0,4))check(fourSlots.delete(JSON.stringify(win.physicalBounds())),'Four-table owner missing its distinct slot');
    check(fourSlots.size===0,'Four-table slots not all occupied');
    check(model.tables.slice(4).every((w,i)=>near(w.physicalBounds(),hiddenBounds[i])),'Hidden closed fixtures were moved');
    await delay(500);const fourStableWrites=tableMoves();await delay(500);
    check(tableMoves()===fourStableWrites,'Settled four-table layout kept writing bounds');
    stages.push({name:'settled-six-to-four',passed:true,count:4,hiddenWindowsAlive:true,unchangedScansWrite:false});
    model.tables[4].visible=true;model.tables[5].visible=true;
    d=await until(()=>{
     const f=diagnostics();
     const numbers=[...owned.values()].filter(r=>!r.win.isDestroyed()&&r.win.getTitle()==='Poker RNG'&&r.win.isVisible()).length;
     return f?.workspace?.layout==='automatic-count-grid'&&f.workspace.tableRects.length===6&&visibleFrames()===6&&numbers===6?f:null;
    },'return from four to six with all number overlays');
    geometryCheck(d.workspace);await rendererChecks();
    stages.push({name:'return-four-to-six',passed:true,count:6});
    for(let id=8;id<=13;id++){
     const win=model.addTable(id);win.minimum={width:560,height:415};win.visible=false;model.tables.push(win);
    }
    // Exercise the same production automatic path across arbitrary counts.
    model.setScale(1);
    for(const count of [5,8,9,12,4,6]){
     model.tables.forEach((w,i)=>{w.visible=i<count;});
     d=await until(()=>{
      const f=diagnostics(),numbers=[...owned.values()].filter(r=>!r.win.isDestroyed()&&r.win.getTitle()==='Poker RNG'&&r.win.isVisible()).length;
      return f?.workspace?.tableRects?.length===count&&visibleFrames()===count&&numbers===count?f:null;
     },'automatic transition to '+count+' tables');
     geometryCheck(d.workspace,count);await rendererChecks(count);
     const focusState=diagnostics()?.sessionFocusPanel;
     check(focusState?.spaceAvailable,'No focus-panel space at fitted count '+count);
     const stable=tableMoves();await delay(250);check(tableMoves()===stable,'Stable '+count+' table state kept moving');
     stages.push({name:'automatic-count-'+count,passed:true,count,grid:d.workspace.grid,tableSize:d.workspace.tableRects[0]});
    }
    finish(true);
   }catch(error){finish(false,error);}
  }};
}
