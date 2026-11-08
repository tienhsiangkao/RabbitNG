import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {parseSimulationLaunch} from './src/simulation-options.js';
import {parseLiveTestLaunch} from './src/live-test-options.js';
import {claimSimulationDirectory,publishSimulationReport} from './src/simulation-profile.js';
import {scheduleSimulation} from './src/simulation-schedule.js';
const require=createRequire(import.meta.url),electron=require('electron');
let config,claimed;
function failed(error){
 console.error('[bootstrap]',error);
 try{if(claimed?.owned)publishSimulationReport(claimed.directory,{status:'failed',error:String(error.stack||error)});}
 catch(reportError){console.error('[simulation report]',reportError);}
 finally{electron.app.exit(1);}
}
try{
 const production=electron.app.getPath('userData');
 const liveConfig=parseLiveTestLaunch(process.argv,production);
 config=liveConfig||parseSimulationLaunch(process.argv,production);
 if(config){
  claimed=claimSimulationDirectory(config.directory,electron.app.getPath('userData'));
  config.directory=claimed.directory;
  const app=electron.app;
  app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.setPath('userData',config.directory);
  const sessionPath=path.join(config.directory,'session');fs.mkdirSync(sessionPath);app.setPath('sessionData',sessionPath);
  app.setName(liveConfig?'Poker RNG Live Test':'Poker RNG Simulation');
  let runtime;
  if(liveConfig){
   const {createLiveTestRuntime}=await import('./src/live-test-runtime.js');
   runtime=createLiveTestRuntime(electron,config,JSON.parse(fs.readFileSync(config.spec,'utf8').replace(/^\uFEFF/,'')));
  }else{
   const {createSimulationRuntime}=await import('./src/simulation-runtime.js');
   runtime=createSimulationRuntime(electron,config);
  }
  Object.defineProperty(globalThis,Symbol.for(liveConfig?'PokerRNG.liveTest':'PokerRNG.simulation'),{value:runtime});
  scheduleSimulation({ready:()=>app.whenReady(),initialize:runtime.initialize,
    loadMain:()=>import('./main.js'),run:runtime.run,failed});
 }else await import('./main.js');
}catch(error){
 failed(error);
}
