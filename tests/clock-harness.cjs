const path=require('path');
const {app,BrowserWindow,ipcMain}=require('electron');
let action=null;
ipcMain.handle('clock:get',()=>({session:'12:34:56',breakDue:true,paused:false}));
ipcMain.on('clock:action',(_event,value)=>{action=value;});
app.whenReady().then(async()=>{
  const windows=[];
  try {
    for(const [width,height,shared,workspace] of [[324,192,true,true],[324,148,true],[135,80,false],[252,123,false],[320,148,false]]) {
      const w=new BrowserWindow({show:false,width,height,frame:false,webPreferences:{preload:path.join(__dirname,'..','src','clock-preload.cjs'),contextIsolation:true,nodeIntegration:false}});
      windows.push(w);
      await w.loadFile(path.join(__dirname,'..','clock.html'),{query:shared?{shared:'1',workspace:workspace?'1':'0'}:{}});
      await new Promise(resolve=>setTimeout(resolve,100));
      const fits=await w.webContents.executeJavaScript(`(() => {
        const elements=Array.from(document.querySelectorAll('.clock,.clock-utc,#session-status,#break-status,body.shared #play-controls,body.shared #focus-status'));
        return !document.getElementById('break-status').hidden && elements.filter(el=>!el.hidden).every(el=>{
          const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight && el.scrollWidth<=el.clientWidth+1;
        });
      })()`);
      if(!fits)throw new Error(`Clock/break cue clipped at ${width}x${height}, shared=${shared}`);
      if(workspace){
        const position=()=>w.webContents.executeJavaScript("document.getElementById('toggle-playing').getBoundingClientRect().y");
        const before=await position();
        w.webContents.send('clock:status',{session:'12:34:56',breakDue:false,paused:false});
        await new Promise(resolve=>setTimeout(resolve,50));
        if(Math.abs(await position()-before)>1)throw new Error('Workspace controls jumped when the break cue changed');
      }
      if(shared) {
        await w.webContents.executeJavaScript("document.getElementById('toggle-playing').click()");
        await new Promise(resolve=>setTimeout(resolve,50));
        if(action!=='start-playing')throw new Error('Playing control did not start the session');
        await w.webContents.executeJavaScript("document.getElementById('clock-snooze').click()");
        await new Promise(resolve=>setTimeout(resolve,50));
        if(action!=='snooze')throw new Error('Shared-clock snooze button did not send its action');
        await w.webContents.executeJavaScript("document.getElementById('clock-break').click()");
        await new Promise(resolve=>setTimeout(resolve,50));
        if(action!=='start-break')throw new Error('Shared-clock break start button did not send its action');
      }
    }
    console.log('PASS: quiet break cue fits small/medium/large table clocks and shared clock; shared buttons send snooze/complete actions');
    app.exit(0);
  }catch(error){console.error(error.stack);app.exit(1);}
});
