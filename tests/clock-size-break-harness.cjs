// Real local clock, preload and IPC in hidden windows. No desktop/GG access.
const fs=require('fs'),os=require('os'),path=require('path');
const {app,BrowserWindow,ipcMain}=require('electron');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
app.disableHardwareAcceleration();app.setName('Poker RNG clock size check');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'pokerrng-clock-size-')));
let status={session:'00:59:59',seconds:3599,playing:true,paused:false,breakDue:false,controlsEnabled:true,layoutEnabled:true},actions=[];
ipcMain.handle('clock:get',()=>status);
ipcMain.on('clock:action',(event,action)=>{
 actions.push(action);
 if(action==='snooze')status={...status,breakDue:false};
 if(action==='start-break')status={...status,breakDue:false,breakActive:true,breakRemainingSeconds:600,playing:false};
 if(action==='start-playing')status={...status,breakDue:false,breakActive:false,breakReady:false,breakRemainingSeconds:0,playing:true};
 event.sender.send('clock:status',status);
});
app.whenReady().then(async()=>{
 let win;
 try{
  win=new BrowserWindow({width:324,height:192,show:false,frame:false,focusable:false,webPreferences:{preload:path.join(root,'src/clock-preload.cjs'),contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  await win.loadFile(path.join(root,'clock.html'),{query:{shared:'1',workspace:'1'}});
  await win.webContents.executeJavaScript('document.fonts.ready');
  const metrics=()=>win.webContents.executeJavaScript(`(()=>{
   const ids=['clock-local','clock-pst','session-status','play-controls','focus-status','break-status'];
   const rows=ids.map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,hidden:e.hidden,font:parseFloat(getComputedStyle(e).fontSize),x:r.x,y:r.y,w:r.width,h:r.height,fits:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&e.scrollWidth<=e.clientWidth+1};});
   return {rows,buttonY:document.getElementById('toggle-playing').getBoundingClientRect().y,breakHidden:document.getElementById('break-status').hidden};
  })()`);
  const settle=()=>new Promise(r=>setTimeout(r,60));await settle();
  const initial=await metrics();
  if(initial.rows[0].font<52||initial.rows[1].font<36)throw Error('Shared clock text was not enlarged to 52px / 36px');
  if(!initial.rows.every(r=>r.fits))throw Error('Clock content clips in idle state: '+JSON.stringify(initial));
  await win.webContents.executeJavaScript('document.getElementById("restore-layout").click()');await settle();
  if(actions.at(-1)!=='restore-layout'||!status.playing)throw Error('Restore layout action failed or changed session');
  for(const state of [{breakDue:true},{breakDue:true,focusError:'Could not minimize all windows'},{breakDue:false,focusError:'',breakActive:true,breakRemainingSeconds:599},{breakActive:false,breakReady:true,breakRemainingSeconds:0},{breakDue:false,focusError:'',breakReady:false}]){
   status={...status,...state};win.webContents.send('clock:status',status);await settle();const current=await metrics();
   if(!current.rows.every(r=>r.fits)||Math.abs(current.buttonY-initial.buttonY)>1)throw Error('Clock content clips or controls shift: '+JSON.stringify(current));
  }
  for(const [id,action]of [['clock-snooze','snooze'],['clock-break','start-break']]){
   status={...status,breakDue:true};win.webContents.send('clock:status',status);await settle();
   await win.webContents.executeJavaScript(`document.getElementById('${id}').click()`);await settle();
   const m=await metrics();if(actions.at(-1)!==action||(action==='snooze'?!m.breakHidden:m.breakHidden))throw Error('Break cue action did not update reminder: '+action);
  }
  const countdown=await win.webContents.executeJavaScript("document.getElementById('break-message').textContent");
  if(countdown!=='Break 10:00')throw Error('Break countdown missing');
  status={...status,breakActive:false,breakReady:true,breakRemainingSeconds:0};win.webContents.send('clock:status',status);await settle();
  const ready=await win.webContents.executeJavaScript("document.getElementById('break-message').textContent");if(!ready.includes('Break finished'))throw Error('Break completion cue missing');
  await win.webContents.executeJavaScript("document.getElementById('toggle-playing').click()");await settle();
  if(actions.at(-1)!=='start-playing'||!(await metrics()).breakHidden)throw Error('Manual Resume did not clear finished break');
  win.setSize(520,308);win.webContents.setZoomFactor(520/324);await settle();
  if(!(await metrics()).rows.every(r=>r.fits))throw Error('Enlarged adaptive clock clips');
  win.webContents.setZoomFactor(1);
  win.setSize(135,110);await win.loadFile(path.join(root,'clock.html'),{query:{shared:'0'}});await win.webContents.executeJavaScript('document.fonts.ready');
  for(const phase of ['active','ready']){
   status={session:'00:50:00',playing:false,breakDue:false,breakActive:phase==='active',breakReady:phase==='ready',breakRemainingSeconds:phase==='active'?599:0};
   win.webContents.send('clock:status',status);await settle();
   const note=await win.webContents.executeJavaScript("document.body.classList.contains('break-notice')");
   if(!note||!(await metrics()).rows.every(r=>r.fits))throw Error('Passive table clock break phase clips or lacks reserved notice state: '+phase);
  }
  if(win.isVisible())throw Error('Clock check unexpectedly showed a window');
  console.log(JSON.stringify({status:'passed',fonts:[initial.rows[0].font,initial.rows[1].font],viewport:[324,192],idleDueAndErrorFit:true,playButtonPositionStable:true,breakActions:actions,hidden:true}));
  win.destroy();app.exit(0);
 }catch(error){console.error(error.stack);try{win?.destroy();}catch{}app.exit(1);}
});
