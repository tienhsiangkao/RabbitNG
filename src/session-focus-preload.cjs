const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('sessionFocus',{
 get:()=>ipcRenderer.invoke('session-focus:get'),
 update:patch=>ipcRenderer.invoke('session-focus:update',patch),
 onChange:callback=>{if(typeof callback!=='function')return;const handler=(_event,state)=>callback(state);ipcRenderer.on('session-focus:state',handler);return ()=>ipcRenderer.off('session-focus:state',handler);}
 ,onFailure:callback=>{if(typeof callback!=='function')return;const handler=(_event,patch)=>callback(patch);ipcRenderer.on('session-focus:failure',handler);return ()=>ipcRenderer.off('session-focus:failure',handler);}
});
