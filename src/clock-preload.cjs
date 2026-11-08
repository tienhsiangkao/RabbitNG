const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('clockComfort',{
  get:()=>ipcRenderer.invoke('clock:get'),
  onStatus:callback=>ipcRenderer.on('clock:status',(_event,status)=>callback(status)),
  action:action=>ipcRenderer.send('clock:action',action)
});
