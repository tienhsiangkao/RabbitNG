import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {LivePlacementGate} from './live-test-gate.js';
import {guardLiveWindow} from './live-test-window.js';
import {classifyPokerUtility,fitPokerUtilitySlot} from './poker-workspace.js';
import {nativeReadbackBounds} from './native-window-bounds.js';
import {publishSimulationReport} from './simulation-profile.js';
import {LiveObservationHealth,boundedRendererRead} from './live-observation-health.js';
const key=r=>`${r.pid??r.processId}:${r.id}:${String(r.path).replaceAll('\\','/').toLowerCase()}`;
const same=(a,b)=>a&&b&&['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<.01);
export function verifyLiveGeometry(targets,windows,adapter){
 for(const {identity,rect} of targets){
  const win=windows.find(w=>key(w)===key(identity));
  if(!win)throw Error('An approved window is missing');
  const scale=win.getMonitor?.()?.getScaleFactor?.();
  if(!Number.isFinite(scale)||scale<=0)throw Error('Unknown native scale');
  if(!same(nativeReadbackBounds(rect,scale),adapter.bounds(win)))throw Error('Client did not retain its identity-specific approved rectangle');
 }
}
export function createLiveTestRuntime(electron,config,spec){
 const {app}=electron,expected=spec.tables,utilities=spec.utilities||[],gate=new LivePlacementGate(expected,utilities),events=[];
 for(const u of utilities)if(!['notes','challenge','replay'].includes(u.role)||typeof u.title!=='string'||!u.title||u.className!=='ApolloRuntimeContentWindow')throw Error('Utility identity must include its recorded title, role and class');
 let adapter,reader,rawWindows,placePhysical,finished=false,timer,watchdog,initialTimer,health,lastSample=-Infinity,observations=0,initialPlan=null,allowed=new Set(),approvedTargets=[];
 const commits=new Map();
 const journal=path.join(config.directory,'observations.jsonl');
 const event=(type,data={})=>{const record={at:new Date().toISOString(),type,...data};events.push(record);fs.appendFileSync(journal,JSON.stringify(record)+'\n');};
 function finish(ok,error){
  if(finished)return;finished=true;clearTimeout(timer);clearTimeout(initialTimer);clearInterval(watchdog);
  const report={status:ok?'passed':'stopped',finishedAt:new Date().toISOString(),reason:error?String(error.stack||error):null,
   phase:gate.phase,authorizedNativeAttempts:gate.writes,nativeWrites:events.filter(e=>e.type==='native-placement'),observations,initialPlan,events,
   scope:'One layout batch then metadata observation; no screenshots, gameplay, buy-in or account actions',
   limits:['A short live test does not establish long-term stability or the cause of historical table closures','Native minima in this bounded test use recorded sizes, not cross-process min/max messages']};
  let code=1;try{publishSimulationReport(config.directory,report);if(ok)code=0;}catch(writeError){console.error('[live report]',writeError);}finally{app.exit(code);}
 }
 const settings=JSON.parse(fs.readFileSync(path.join(app.getAppPath(),'settings.json'),'utf8'));
 settings.autoStartEnabled=false;settings.comfortDefaultsVersion=4;settings.thinBorderDefaultsVersion=1;
 settings.workspace={enabled:true};settings.comfort={clockMode:'shared',breakEnabled:false};
 settings.tableLayout={enabled:true,autoArrange:true,lockLayout:false,arrangeOnStartup:true,restoreOnStop:false,
  activeProfileId:'automatic',profiles:[{id:'automatic',name:'Bounded live test',monitorId:'primary',rows:0,columns:0,gap:0,margin:0}]};
 settings.scanMs=250;settings.quietMode=true;settings.showOnlyActiveTables=false;
 settings.overlays={...settings.overlays,buyInEnabled:true,clockEnabled:true,stakeFrameEnabled:true};
 fs.writeFileSync(path.join(config.directory,'settings.json'),JSON.stringify(settings,null,2));
 fs.writeFileSync(path.join(config.directory,'spec.json'),JSON.stringify(spec,null,2));
 for(const name of ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'])childProcess[name]=()=>{const error=Error('Child commands are disabled in bounded live mode');finish(false,error);throw error;};
 syncBuiltinESMExports();
 timer=setTimeout(()=>finish(false,new Error('Live test did not reach placement within 30 seconds')),30000);
 watchdog=setInterval(()=>{try{health?.check();}catch(error){finish(false,error);}},500);
 process.on('uncaughtException',error=>finish(false,error));process.on('unhandledRejection',error=>finish(false,error instanceof Error?error:new Error(String(error))));
 const matchesUtility=(win,u)=>key(win)===key(u)&&win.getTitle?.()===u.title&&reader(win).className===u.className;
 const runtime={gate,initialize(){},run(){},fail:error=>finish(false,error),focusAdapter:{list:()=>[],inspect:()=>null},globalShortcut:{register:()=>true,unregisterAll(){}},
  recordRngCommit(sender,record){commits.set(sender.id,record);},
  isTarget:win=>expected.some(r=>key(r)===key(win)),
  wrapWindowManager(real){
   rawWindows=()=>real.getWindows();
   const wrap=win=>win&&guardLiveWindow(win,{gate,adapter:()=>adapter,
    beforeWrite:()=>{if(!runtime.preflight(rawWindows()))throw Error('Live preflight failed before placement');},
    writePhysical:(identity,rect)=>placePhysical(identity,rect),
    onViolation:error=>finish(false,error),onWrite:(identity,rect)=>event('native-placement',{identity,rect})});
   return {getWindows:()=>real.getWindows().map(wrap),getMonitors:()=>real.getMonitors(),getActiveWindow:()=>null};
  },
  wrapAdapter(real,displayReader,physicalPlacer){
   reader=displayReader;placePhysical=physicalPlacer;
   adapter={...real,inspect:win=>{
    const state=reader(win);
    if(expected.some(r=>key(r)===key(win)))return {...state,min:{width:560,height:415},max:{width:9999,height:9999}};
    const utility=utilities.find(u=>matchesUtility(win,u));
    if(utility?.role==='challenge')return {...state,min:{width:424,height:600},max:{width:424,height:600}};
    if(utility?.role==='replay')return {...state,min:{width:898,height:700},max:{width:898,height:2160}};
    if(utility?.role==='notes')return {...state,min:{width:404,height:582},max:{width:404,height:582}};
    return state;
   }};return adapter;
  },
  preflight(nativeWindows){
   if(finished)return false;
   if(fs.existsSync(path.join(config.directory,'stop.requested'))){finish(false,new Error('User requested test stop'));return false;}
   try{
    health?.sample();
    const actual=expected.map(identity=>{const win=nativeWindows.find(w=>key(w)===key(identity));return {...identity,visible:!!win&&adapter.visible(win)};});
    gate.checkExpected(actual);
    for(const u of utilities){const win=nativeWindows.find(w=>key(w)===key(u));if(!win||!adapter.visible(win)||!matchesUtility(win,u))throw Error('Recorded utility is missing, hidden or changed');}
    if(gate.phase==='observing')verifyLiveGeometry(approvedTargets.filter(t=>t.kind==='table'),nativeWindows,adapter);
    if(performance.now()-lastSample>=1000){lastSample=performance.now();observations++;event('observation',{tables:actual.map(r=>{const w=nativeWindows.find(w=>key(w)===key(r));return {...r,bounds:adapter.bounds(w)};})});}
    return true;
   }catch(error){finish(false,error);return false;}
  },
  beginPlacement(plan,reservations,nativeWindows){
   if(gate.phase!=='waiting')return false;
   try{
    if(plan?.mode!=='full'||plan.layout!=='six-centered-shelf')throw Error('Accepted six-table shelf is unavailable');
    const targets=expected.map(identity=>{const r=reservations.find(r=>r.id===identity.id&&r.pid===identity.pid);if(!r)throw Error('Missing table reservation');return {identity,rect:r.target,kind:'table'};});
    const clients=new Set(expected.map(r=>`${r.pid}:${String(r.path).toLowerCase()}`));
    const usedRoles=new Set();
    for(const u of [...utilities].sort((a,b)=>a.id-b.id)){
     const win=nativeWindows.find(w=>key(w)===key(u));
     if(!win||!clients.has(`${win.processId}:${String(win.path).toLowerCase()}`)||!adapter.visible(win)||!matchesUtility(win,u))throw Error('Recorded utility lost eligibility');
     const info=adapter.inspect(win),role=classifyPokerUtility(win,info);
     if(role!==u.role)throw Error('Recorded utility role is ambiguous');
     const rect=role&&plan.slots[role]&&fitPokerUtilitySlot(plan.slots[role],info,plan.scaleFactor);
     if(!rect||(usedRoles.has(role)&&!plan.sharedRoles?.includes(role)))throw Error('Recorded utility cannot occupy a distinct approved region');
     targets.push({identity:{id:win.id,pid:win.processId,path:win.path},rect,kind:'utility'});usedRoles.add(role);
    }
    gate.begin(targets);approvedTargets=targets;allowed=new Set(targets.map(t=>key(t.identity)));initialPlan=plan;event('placement-authorized',{targets});return true;
   }catch(error){finish(false,error);return false;}
  },
  placementWindows:windows=>windows.filter(w=>allowed.has(key(w))),
  endPlacement(nativeWindows){
   if(finished)return;
   try{
    gate.closeBatch();
    verifyLiveGeometry(approvedTargets,nativeWindows,adapter);
    event('placement-complete',{nativeWrites:gate.writes.length});clearTimeout(timer);
    health=new LiveObservationHealth();
    initialTimer=setTimeout(()=>{void checkOwnRenderers('initial').catch(error=>finish(false,error));},1000);
    timer=setTimeout(async()=>{
     try{
      if(!runtime.preflight(rawWindows()))return;
      health.complete();await checkOwnRenderers('final');
      if(!runtime.preflight(rawWindows()))return;
      finish(true);
     }catch(error){finish(false,error);}
    },120000);
   }catch(error){finish(false,error);}
  }
 };
 async function checkOwnRenderers(stage){
  const deadline=performance.now()+4000;
  while(!finished){
   const windows=electron.BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed());
   const numbers=windows.filter(w=>w.getTitle()==='Poker RNG'&&w.isVisible()),metrics=[],seen=new Set();
   let valid=numbers.length===6;
   for(const win of numbers){
    const remaining=deadline-performance.now();if(remaining<=0)throw Error('Own renderer verification deadline exceeded');
    const m=await boundedRendererRead(()=>win.webContents.executeJavaScript(`(()=>{const n=document.getElementById('num'),r=n.getBoundingClientRect(),c=document.querySelector('.card').getBoundingClientRect(),digits=Array.from(n.children).map(el=>el.textContent).join('');return {digits,rolling:n.classList.contains('rolling'),fits:r.width>0&&r.height>0&&r.left>=c.left-1&&r.top>=c.top-1&&r.right<=c.right+1&&r.bottom<=c.bottom+1};})()`),Math.min(1000,remaining));
    const commit=commits.get(win.webContents.id),target=approvedTargets.find(t=>t.kind==='table'&&t.identity.id===commit?.tableId);
    const bounds=win.getBounds(),table=target&&electron.screen.screenToDipRect(null,target.rect);
    const inside=table&&bounds.x>=table.x&&bounds.y>=table.y&&bounds.x+bounds.width<=table.x+table.width&&bounds.y+bounds.height<=table.y+table.height;
    if(!/^\d{2}$/.test(m.digits)||m.rolling||!m.fits||!target||seen.has(commit.tableId)||commit.value!==Number(m.digits)||!inside)valid=false;
    if(commit)seen.add(commit.tableId);metrics.push({...m,tableId:commit?.tableId,bounds});
   }
   valid=valid&&seen.size===6&&windows.some(w=>w.getTitle()==='Poker Session Clock'&&w.isVisible()&&same(w.getBounds(),electron.screen.screenToDipRect(null,initialPlan.slots.clock)));
   if(valid){event('own-renderers-checked',{stage,numbers:metrics,sharedClockVisible:true});return;}
   if(performance.now()>=deadline)throw Error('Own RNG renderers did not settle at the six distinct table positions');
   await new Promise(resolve=>setTimeout(resolve,80));
  }
  throw Error('Live test stopped before renderer verification');
 }
 return runtime;
}
