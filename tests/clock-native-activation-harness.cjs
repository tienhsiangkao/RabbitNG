// Hidden, owned windows only. No GG discovery, screen capture or input injection.
const fs=require('fs'),path=require('path'),vm=require('vm');
const {app,BrowserWindow,ipcMain}=require('electron'),koffi=require('koffi');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
app.disableHardwareAcceleration();app.setName('Poker RNG own-clock input check');
const profile=fs.mkdtempSync(path.join(require('os').tmpdir(),'pokerrng-clock-native-'));
app.setPath('userData',profile);
ipcMain.handle('clock:get',()=>({controlsEnabled:true,playing:false,session:'00:00:00'}));
app.whenReady().then(async()=>{
 let clock;
 try{
  const source=fs.readFileSync(path.join(root,'main.js'),'utf8');
  const context=vm.createContext({settings:{comfort:{}},screen:{screenToDipRect:(_,r)=>r,getDisplayMatching:()=>({workArea:{x:0,y:0,width:3840,height:2112}})},
   workspacePlan:{slots:{clock:{x:0,y:0,width:324,height:192}}},sharedClockProgrammaticBounds:null,workspaceClockManual:false,
   sharedClockWindow:null,sharedClockReady:false,BrowserWindow,app:{getAppPath:()=>root},path,console,syncComfortWindows(){}});
  vm.runInContext(source.slice(source.indexOf('function createSharedClock('),source.indexOf('\nfunction syncComfortWindows(')),context);
  context.createSharedClock([{lastTableBounds:{x:0,y:0,width:982,height:702}}]);clock=context.sharedClockWindow;
  await new Promise((resolve,reject)=>{clock.webContents.once('did-finish-load',resolve);clock.webContents.once('did-fail-load',(_,code,description)=>reject(Error(description)));});
  await new Promise(resolve=>setTimeout(resolve,100));
  const handle=Number(clock.getNativeWindowHandle().readBigUInt64LE());
  const user=koffi.load('user32.dll'),owner=user.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hwnd,_Out_ uint32_t *pid)');
  const send=user.func('intptr_t __stdcall SendMessageTimeoutW(uintptr_t hwnd,uint32_t msg,uintptr_t wp,intptr_t lp,uint32_t flags,uint32_t timeout,_Out_ intptr_t *result)');
  const pid=[0];if(!owner(handle,pid)||pid[0]!==process.pid)throw Error('Refusing to inspect a foreign window');
  const result=[0];if(!send(handle,0x21,handle,(0x201<<16)|1,3,100,result))throw Error('Owned activation query failed');
  if(result[0]!==1&&result[0]!==3)throw Error('Windows discards the clock click: WM_MOUSEACTIVATE='+result[0]);
  if(clock.isVisible())throw Error('Input test unexpectedly showed a window');
  console.log(JSON.stringify({status:'passed',mouseActivationResult:result[0],hidden:true,ownedProcess:process.pid,normalClockConstructor:true}));
  clock.destroy();app.exit(0);
 }catch(error){console.error(error.stack);try{clock?.destroy();}catch{}app.exit(1);}
});
