// Electron must finish loading the ESM entry before it can emit ready.
export function scheduleSimulation({ready,initialize,loadMain,run,failed}){
 void Promise.resolve().then(ready).then(async()=>{initialize();await loadMain();await run();}).catch(failed);
}
