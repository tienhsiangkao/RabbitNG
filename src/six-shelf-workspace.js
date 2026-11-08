import {calculateSixShelf} from './six-shelf-layout.js';
import {SixShelfSession} from './table-slot-session.js';
const identityKey=r=>`${r.pid??r.processId}:${r.id}`;
const unavailable=()=>({mode:'unavailable',layout:'six-centered-shelf',tableArea:null,tableRects:null,
 utilities:null,slots:{},sharedRoles:['replay'],message:'The six-table shelf cannot fit all native windows on this display; current positions are preserved.'});

// Keeps geometry and identity reservations separate from native window writes.
export class SixShelfWorkspace {
 #session=null;
 #plan=null;
 #minimums=new Map();
 #pendingCount=null;
 unassigned=[];
 get active(){return this.#session!==null;}
 get reservations(){return this.#session?.sync([]).reservations||[];}
 reset({preserveMinimums=false}={}){this.#session=null;this.#plan=null;if(!preserveMinimums)this.#minimums.clear();this.#pendingCount=null;this.unassigned=[];}
 tableMinimumFor(records,fallback={width:560,height:415}){
  const minimum={...fallback};
  for(const record of records){
   const key=identityKey(record),min=record.minimum;
   if(min&&['width','height'].every(k=>Number.isFinite(min[k])&&min[k]>0)){
    this.#minimums.delete(key);this.#minimums.set(key,{width:min.width,height:min.height});
   }
   const known=this.#minimums.get(key);
   if(known)for(const k of ['width','height'])minimum[k]=Math.max(minimum[k],known[k]);
  }
  while(this.#minimums.size>256)this.#minimums.delete(this.#minimums.keys().next().value);
  return minimum;
 }
 shouldRetile({visible,inactive,enabled,now}){
  const owners=new Set(this.reservations.map(identityKey)),seen=new Set(visible.map(identityKey));
  const retired=new Set(inactive.map(identityKey));
  if(!enabled||!this.active||!Number.isFinite(now)||seen.size!==visible.length||seen.size===0||seen.size>=6||
    [...seen].some(k=>!owners.has(k))||[...owners].some(k=>!seen.has(k)&&!retired.has(k))){
   this.#pendingCount=null;return false;
  }
  const key=JSON.stringify([...seen].sort());
  if(!this.#pendingCount||this.#pendingCount.key!==key||now<this.#pendingCount.last||now-this.#pendingCount.last>5000){
   this.#pendingCount={key,since:now,last:now};return false;
  }
  this.#pendingCount.last=now;
  return now-this.#pendingCount.since>=3000;
 }
 update(observed,{workArea,scaleFactor=1,tableMinimum={width:560,height:415},destroyed=[]}={}){
  if(!Array.isArray(observed))throw new TypeError('Table observations must be an array');
  if(!this.#session&&observed.length!==6)return null;
  if(!this.#session){
   const seed=calculateSixShelf(workArea,{scaleFactor});
   if(!seed){this.#plan=unavailable();return this.#plan;}
   this.#session=new SixShelfSession(seed);
  }
  const result=this.#session.sync(observed,{released:destroyed});this.unassigned=result.unassigned;
  if(!result.reservations.length&&!observed.length){this.reset();return null;}
  const owners=new Set(result.reservations.map(identityKey));
  for(const key of this.#minimums.keys())if(!owners.has(key))this.#minimums.delete(key);
  for(const record of observed){
   if(!owners.has(identityKey(record)))continue;
   const min=record.minimum;
   if(min&&['width','height'].every(k=>Number.isFinite(min[k])&&min[k]>0))this.#minimums.set(identityKey(record),{...min});
  }
  const minimum={...tableMinimum};
  for(const min of this.#minimums.values())for(const key of ['width','height'])minimum[key]=Math.max(minimum[key],min[key]);
  const plan=calculateSixShelf(workArea,{scaleFactor,tableMinimum:minimum});
  if(!plan){this.#plan=unavailable();return this.#plan;}
  this.#session.setPlan(plan);
  this.#plan=plan;return plan;
 }
 targetsFor(orderedWindows){
  if(!this.#session||this.#plan?.mode!=='full')return null;
  const targets=new Map(this.reservations.map(r=>[identityKey(r),r.target]));
  return orderedWindows.map(win=>targets.get(identityKey(win)));
 }
}
