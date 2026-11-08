const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rng", {
  onTableSize: (cb) => {
    if (typeof cb !== "function") return undefined;
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("table-size", handler);
    return () => ipcRenderer.off("table-size", handler);
  },
  onRollNow: (cb) => {
    if (typeof cb !== "function") return undefined;
    const handler = (_event, value) => cb(value);
    ipcRenderer.on("roll-now", handler);
    return () => ipcRenderer.off("roll-now", handler);
  },
  onSetAutoRollInterval: (cb) => {
    if (typeof cb !== "function") return undefined;
    const handler = (_event, value) => cb(value);
    ipcRenderer.on("set-auto-roll-interval", handler);
    return () => ipcRenderer.off("set-auto-roll-interval", handler);
  },
  reportValue: (value, rollId) => ipcRenderer.send("rng-value", value, rollId),
  requestRoll: (reason = "manual") => ipcRenderer.send("rng-clicked", reason),
  setInterval: (seconds) => ipcRenderer.send("set-auto-roll-interval", seconds)
});
