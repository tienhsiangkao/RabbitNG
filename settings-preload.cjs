const { contextBridge, ipcRenderer } = require("electron");

const api = {
  get: () => ipcRenderer.invoke("settings:get"),
  update: (patch) => ipcRenderer.invoke("settings:update", patch),
  onChange: (cb) => {
    if (typeof cb !== "function") return;
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("settings:updated", handler);
    return () => ipcRenderer.off("settings:updated", handler);
  }
};

contextBridge.exposeInMainWorld("appSettings", api);
