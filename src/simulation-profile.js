import fs from 'node:fs';
import path from 'node:path';
import {parseSimulationLaunch} from './simulation-options.js';
function canonical(input){
 let existing=path.resolve(input);const suffix=[];
 while(!fs.existsSync(existing)){suffix.unshift(path.basename(existing));const parent=path.dirname(existing);if(parent===existing)throw Error('No existing profile ancestor');existing=parent;}
 return path.resolve(fs.realpathSync.native(existing),...suffix);
}
export function claimSimulationDirectory(directory,productionDirectory){
 if(fs.existsSync(directory))throw Error('Simulation requires a fresh, unused directory');
 const resolved=canonical(directory),production=canonical(productionDirectory);
 parseSimulationLaunch(['--simulate',`--simulation-dir=${resolved}`],production);
 fs.mkdirSync(path.dirname(resolved),{recursive:true});
 fs.mkdirSync(resolved); // Exclusive ownership: never reuse a pre-existing profile.
 return {directory:fs.realpathSync.native(resolved),owned:true};
}
export function publishSimulationReport(directory,report){
 fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
}
