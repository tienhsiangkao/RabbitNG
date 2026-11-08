const pathKey=p=>String(p).replaceAll('\\','/').toLowerCase();
const key=r=>`${r.pid??r.processId}:${r.id}:${pathKey(r.path)}`;
function identity(r){
 if(!r||!Number.isSafeInteger(r.id)||r.id<=0||!Number.isSafeInteger(r.pid??r.processId)||
  (r.pid??r.processId)<=0||!/(^|[\\/])(ggnet|ggpoker|ggpcom|natural8|natural8net)\.exe$/i.test(r.path||''))throw Error('Invalid GG identity');
 return {id:r.id,pid:r.pid??r.processId,path:r.path};
}
export class LivePlacementGate{
 phase='waiting';
 writes=[];
 #expected;
 #utilities;
 #targets=new Map();
 #written=new Set();
 constructor(expected,utilities=[]){
  if(!Array.isArray(expected)||expected.length!==6)throw Error('Exactly six recorded tables are required');
  this.#expected=Array.from(expected,identity);
  if(new Set(this.#expected.map(key)).size!==6)throw Error('Duplicate target identity');
  if(!Array.isArray(utilities))throw Error('Invalid utility identities');
  this.#utilities=new Set(Array.from(utilities,r=>key(identity(r))));
  if(this.#utilities.size!==utilities.length||this.#expected.some(r=>this.#utilities.has(key(r))))throw Error('Duplicate utility identity');
 }
 #deny(message){this.phase='aborted';throw Error(message);}
 checkExpected(actual){
  if(this.phase==='aborted')this.#deny('Live test already aborted');
  for(const wanted of this.#expected)if(!actual.some(r=>key(r)===key(wanted)&&r.visible===true))this.#deny('Expected table is hidden, missing or replaced');
 }
 begin(targets){
  if(this.phase!=='waiting')this.#deny('Only one placement batch is permitted');
  const expected=new Set(this.#expected.map(key)),clients=new Set(this.#expected.map(r=>`${r.pid}:${pathKey(r.path)}`));
  const validated=new Map();
  for(const target of targets){
   const owner=identity(target.identity),rect=target.rect;
   if(!clients.has(`${owner.pid}:${pathKey(owner.path)}`)||!rect||!['x','y','width','height'].every(k=>Number.isSafeInteger(rect[k]))||rect.width<=0||rect.height<=0)this.#deny('Invalid placement scope or rectangle');
   if(target.kind==='table'){if(!expected.delete(key(owner)))this.#deny('Unknown or duplicate table placement');}
   else if(target.kind!=='utility'||!this.#utilities.has(key(owner)))this.#deny('Unrecorded utility placement');
   if(validated.has(key(owner)))this.#deny('Duplicate window target');
   validated.set(key(owner),{...rect});
  }
  if(expected.size)this.#deny('Placement plan does not cover all six tables');
  this.#targets=validated;this.phase='applying';
 }
 allowWrite(owner,rect){
  const k=key(owner),target=this.#targets.get(k);
  if(this.phase!=='applying'||!target||this.#written.has(k)||!['x','y','width','height'].every(p=>rect[p]===target[p]))this.#deny('Native write is outside the one-time placement plan');
  this.#written.add(k);this.writes.push({identity:identity(owner),rect:{...rect}});return true;
 }
 closeBatch(){if(this.phase!=='applying')this.#deny('No placement batch is open');this.phase='observing';}
}
