// // Expose minimal IPC to the renderer
// const { contextBridge, ipcRenderer } = require("electron");
// contextBridge.exposeInMainWorld("rng", {
//   onPromptSetUpper: (cb) => ipcRenderer.on("prompt-set-upper", cb),
//   getUpper: () => ipcRenderer.invoke("get-upper"),
//   setUpper: (v) => ipcRenderer.invoke("set-upper", v),
// });
// preload.cjs
// Minimal, safe bridge: subscribe-only channels used by renderer.
// - contextIsolation: true
// Minimal, event-only bridge
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rng", {
  onTableSize: (cb) => ipcRenderer.on("table-size", (_e, d) => cb?.(d)),
  onRollNow:   (cb) => ipcRenderer.on("roll-now",   () => cb?.()),
  // called when user finishes dragging overlay
  dragEnded:   ()   => ipcRenderer.send("drag-ended")
});
