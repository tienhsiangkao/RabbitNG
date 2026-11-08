const {contextBridge,ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('stakeFrame', {
  onState(callback) {
    const listener = (_event,state) => callback(state);
    ipcRenderer.on('stake-frame-state',listener);
    return () => ipcRenderer.removeListener('stake-frame-state',listener);
  },
  reportDrawn(state) { ipcRenderer.send('stake-frame-drawn',state); }
});
