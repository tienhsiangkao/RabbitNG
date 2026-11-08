import path from 'node:path';
import {parseSimulationLaunch} from './simulation-options.js';
export function parseLiveTestLaunch(argv,production){
 const flags=argv.filter(a=>typeof a==='string'&&/^-+live/i.test(a));
 if(!flags.length)return null;
 if(argv.some(a=>typeof a==='string'&&/^-+simulat/i.test(a)))throw Error('Live and simulation modes cannot be combined');
 if(flags.filter(a=>a==='--live-test').length!==1)throw Error('Explicit --live-test is required');
 const dirs=flags.filter(a=>a.startsWith('--live-test-dir=')),specs=flags.filter(a=>a.startsWith('--live-test-spec=')),times=flags.filter(a=>a.startsWith('--live-test-duration-ms='));
 if(dirs.length!==1||specs.length!==1||times.length>1||flags.length!==1+dirs.length+specs.length+times.length)throw Error('Invalid live test arguments');
 const dir=dirs[0].slice('--live-test-dir='.length),spec=specs[0].slice('--live-test-spec='.length);
 const directory=parseSimulationLaunch(['--simulate',`--simulation-dir=${dir}`],production).directory;
 if(!path.isAbsolute(spec))throw Error('Live test specification must be absolute');
 const durationMs=times.length?Number(times[0].slice('--live-test-duration-ms='.length)):120000;
 if(durationMs!==120000)throw Error('The bounded live test lasts exactly 120 seconds');
 return {directory,spec:path.resolve(spec),durationMs};
}
