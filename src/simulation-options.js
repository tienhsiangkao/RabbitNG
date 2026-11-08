import path from 'node:path';
export function parseSimulationLaunch(argv,productionDirectory){
 const flags=argv.filter(a=>typeof a==='string'&&/^-+simulat/i.test(a));
 if(!flags.length)return null;
 if(flags.filter(a=>a==='--simulate').length!==1)throw new Error('Simulation requires one explicit --simulate flag');
 const dirs=flags.filter(a=>a.startsWith('--simulation-dir='));
 const times=flags.filter(a=>a.startsWith('--simulation-timeout-ms='));
 if(dirs.length!==1||times.length>1||flags.length!==1+dirs.length+times.length)throw new Error('Invalid simulation arguments');
 const supplied=dirs[0].slice('--simulation-dir='.length);
 if(!path.isAbsolute(supplied))throw new Error('Simulation directory must be absolute');
 const directory=path.resolve(supplied),production=path.resolve(productionDirectory);
 const normalized=p=>(process.platform==='win32'?p.toLowerCase():p);
 const contains=(parent,child)=>{const relative=path.relative(normalized(parent),normalized(child));return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
 if(directory===path.parse(directory).root||contains(directory,production)||contains(production,directory))throw new Error('Simulation must be outside the production profile');
 const timeoutMs=times.length?Number(times[0].slice('--simulation-timeout-ms='.length)):45000;
 if(!Number.isInteger(timeoutMs)||timeoutMs<5000||timeoutMs>60000)throw new Error('Simulation timeout must be 5000–60000ms');
 return {directory,timeoutMs};
}
