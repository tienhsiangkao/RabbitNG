// Offline identity reservations only. This module never moves a window.
const key=r=>`${r.pid}:${r.id}`;
function identity(record){
 if(!record||!Number.isSafeInteger(record.id)||record.id<=0||
   !Number.isSafeInteger(record.pid)||record.pid<=0)throw new TypeError('A positive window ID and process ID are required');
 return {id:record.id,pid:record.pid};
}
const copyBinding=r=>({...r,target:{...r.target}});

export class SixShelfSession {
 #targets;
 #bindings=new Map();
 constructor(plan){
  this.setPlan(plan);
 }
 setPlan(plan){
  const rects=plan?.tableRects;
  if(!Array.isArray(rects)||rects.length!==6||Array.from(rects).some(r=>!r||
    !['x','y','width','height'].every(k=>Number.isSafeInteger(r[k]))||r.width<=0||r.height<=0))
   throw new TypeError('Six valid table rectangles are required');
  this.#targets=rects.map(r=>({...r}));
  for(const binding of this.#bindings.values())binding.target={...this.#targets[binding.slot]};
 }
 replaceIdentity(previous,next){
  identity(previous);identity(next);
  if(previous.pid!==next.pid||this.#bindings.has(key(next)))return false;
  const binding=this.#bindings.get(key(previous));if(!binding)return false;
  this.#bindings.delete(key(previous));
  this.#bindings.set(key(next),{...binding,...identity(next)});return true;
 }
 sync(observed,{released=[]}={}){
  if(!Array.isArray(observed)||!Array.isArray(released))throw new TypeError('Observations and releases must be arrays');
  const seen=new Set();
  const records=Array.from(observed,record=>{
   const ids=identity(record),level=record.level??0,visible=record.visible??true;
   if(typeof level!=='number'||!Number.isFinite(level)||level<0||typeof visible!=='boolean')
    throw new TypeError('Invalid stake level or visibility');
   if(seen.has(key(ids)))throw new TypeError('Duplicate table identity');
   seen.add(key(ids));return {...ids,level,visible};
  });
  const releaseKeys=Array.from(released,r=>key(identity(r)));
  // Validate the complete batch before changing reservations.
  for(const k of releaseKeys)this.#bindings.delete(k);
  const used=new Set([...this.#bindings.values()].map(r=>r.slot));
  const candidates=records.filter(r=>r.visible&&!this.#bindings.has(key(r)))
   .sort((a,b)=>b.level-a.level);
  const added=[],unassigned=[];
  for(const record of candidates){
   const slot=this.#targets.findIndex((_,i)=>!used.has(i));
   if(slot<0){unassigned.push({...record});continue;}
   const binding={id:record.id,pid:record.pid,level:record.level,slot,target:{...this.#targets[slot]}};
   this.#bindings.set(key(record),binding);used.add(slot);added.push(copyBinding(binding));
  }
  const reservations=[...this.#bindings.values()].sort((a,b)=>a.slot-b.slot).map(copyBinding);
  const visibleKeys=new Set(records.filter(r=>r.visible).map(key));
  const placements=reservations.filter(r=>visibleKeys.has(key(r))).map(copyBinding);
  return {reservations,placements,added,unassigned};
 }
}
