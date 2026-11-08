export function installSimulationGuards({Module,childProcess,syncBuiltinESMExports}){
 const calls={nativeModuleAttempts:0,childCommandAttempts:0};
 const originalLoad=Module._load;
 Module._load=function(request,...rest){
  if(/(^|[\\/])(node-window-manager|koffi|extract-file-icon)([\\/]|$)/i.test(String(request))){
   calls.nativeModuleAttempts++;throw new Error('Native window packages are disabled in simulation');
  }
  return Reflect.apply(originalLoad,this,[request,...rest]);
 };
 for(const name of ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork']){
  childProcess[name]=()=>{calls.childCommandAttempts++;throw new Error('Child commands are disabled in simulation');};
 }
 syncBuiltinESMExports();return calls;
}
