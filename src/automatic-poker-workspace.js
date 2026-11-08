import {calculatePokerWorkspace,isGgProcess} from './poker-workspace.js';
import {stakeBadgeForTitle} from './table-stakes.js';
const key=r=>`${r.pid??r.processId}:${r.id}`;
const goodMinimum=m=>m&&['width','height'].every(k=>Number.isFinite(m[k])&&m[k]>0);
const TABLE_SETTLE_MS=2000;
const unavailable=message=>({mode:'unavailable',layout:'automatic-count-grid',tableArea:null,tableRects:null,slots:{},sharedRoles:['replay'],message});

// One identity/count lifecycle for every automatic GG layout. Native operations
// stay in the existing placement managers; this class only returns a plan.
export class AutomaticPokerWorkspace {
 kind='automatic-counts';
 #owners=new Map();#minimums=new Map();#arrival=new Map();#nextOrder=1;
 #pending=null;#plan=null;#planKey='';
 get active(){return this.#owners.size>0;}
 #ordered(){return [...this.#owners.values()].sort((a,b)=>b.level-a.level||a.order-b.order);}
 get reservations(){return this.#ordered().map((r,slot)=>({...r,slot,target:this.#plan?.tableRects?.[slot]?{...this.#plan.tableRects[slot]}:null}));}
 reset({preserveMinimums=false}={}){this.#owners.clear();this.#pending=null;this.#plan=null;this.#planKey='';this.#arrival.clear();this.#nextOrder=1;if(!preserveMinimums)this.#minimums.clear();}
 targetsFor(windows){
  if(this.#plan?.mode!=='full')return null;
  const targets=new Map(this.reservations.map(r=>[key(r),r.target]));
  return windows.map(w=>targets.get(key(w)));
 }
 #remember(win,adapter){
  const identity=key(win);let minimum;
  try{minimum=adapter.inspect(win)?.min;}catch{}
  if(goodMinimum(minimum)){this.#minimums.delete(identity);this.#minimums.set(identity,{width:minimum.width,height:minimum.height});}
  while(this.#minimums.size>512){const stale=[...this.#minimums.keys()].find(k=>!this.#owners.has(k));if(!stale)break;this.#minimums.delete(stale);}
  return this.#minimums.has(identity);
 }
 #geometry(monitor,profile){
  if(!this.active)return null;
  const minimum={width:0,height:0};
  for(const k of this.#owners.keys()){
   const m=this.#minimums.get(k);if(!m)return unavailable('Waiting for verified table size limits.');
   for(const d of ['width','height'])minimum[d]=Math.max(minimum[d],m[d]);
  }
  const signature=JSON.stringify([monitor.workArea,monitor.scaleFactor,this.#owners.size,minimum,profile]);
  if(signature!==this.#planKey){
   this.#plan=calculatePokerWorkspace(monitor.workArea,this.#owners.size,{scaleFactor:monitor.scaleFactor,tableMinimum:minimum,profile,automaticPolicy:true});
   this.#planKey=signature;
  }
  return this.#plan;
 }
 prepare({tables,nativeWindows,adapter,monitor,profile,now=performance.now(),mixedPresence=false}){
  const visible=tables.filter(w=>{try{return adapter.visible(w)===true;}catch{return false;}});
  const gg=visible.filter(isGgProcess),matched=new Map(gg.map(w=>[key(w),w]));
  if((!this.active&&visible.length!==gg.length)||(!this.active&&!gg.length)||
    ((profile.rows||profile.columns)&&visible.length!==gg.length)){
   if(this.active)this.reset({preserveMinimums:true});
   return {plan:null,layoutWindows:visible};
  }
  if(profile.rows||profile.columns){
   // Explicit grids keep their fixed shape and existing manual semantics.
   this.reset({preserveMinimums:true});
   const minimum={width:560,height:415};
   for(const w of visible){this.#remember(w,adapter);const m=this.#minimums.get(key(w));if(m)for(const d of ['width','height'])minimum[d]=Math.max(minimum[d],m[d]);}
   return {plan:calculatePokerWorkspace(monitor.workArea,visible.length,{scaleFactor:monitor.scaleFactor,tableMinimum:minimum,profile}),layoutWindows:visible};
  }
  const native=new Map(nativeWindows.map(w=>[key(w),w])),states=new Map();
  const read=w=>{const k=key(w);if(!states.has(k)){try{states.set(k,adapter.layoutState?.(w));}catch{states.set(k,null);}}return states.get(k);};
  const positive=w=>{const s=read(w);return s?.nativeVisible===true&&s.minimized===false&&s.cloaked===false;};
  let blocked=mixedPresence||visible.length!==gg.length||!Number.isFinite(now),allDestroyed=this.active;
  const desired=new Map();
  for(const [k,owner]of this.#owners){
   const win=native.get(k);
   if(!win){
    let dead=false;try{dead=adapter.isAlive(owner)===false;}catch{}
    if(!dead){blocked=true;allDestroyed=false;desired.set(k,owner);}continue;
   }
   allDestroyed=false;
   const state=read(win);
   if(state?.nativeVisible===false&&state.minimized===false&&state.cloaked===false)continue;
   desired.set(k,owner);
   if(!positive(win)||!matched.has(k))blocked=true;
  }
  for(const win of gg){
   const k=key(win);
   if(!this.#owners.has(k)&&desired.size>=144){blocked=true;continue;}
   if(!native.has(k)||!positive(win)){blocked=true;continue;}
   if(!this.#remember(win,adapter)){blocked=true;continue;}
   if(!this.#arrival.has(k))this.#arrival.set(k,this.#nextOrder++);
   let level=0;try{level=stakeBadgeForTitle(win.getTitle?.()||'')?.level||0;}catch{}
   const record={id:win.id,pid:win.processId,level,order:this.#arrival.get(k)};
   desired.set(k,record);
   if(this.#owners.has(k))this.#owners.set(k,record);
  }
  // Once every GG owner is positively destroyed, unrelated clients must not
  // keep a dead GG session alive. They return to their ordinary routing.
  if(allDestroyed&&!gg.length)blocked=!Number.isFinite(now);
  const topology=records=>JSON.stringify([...records.keys()].sort());
  if(blocked||(!desired.size&&!allDestroyed)||!Number.isFinite(now))this.#pending=null;
  else if(topology(desired)===topology(this.#owners))this.#pending=null;
  else{
   const proposal=topology(desired);
   if(!this.#pending||this.#pending.key!==proposal||now<this.#pending.last||now-this.#pending.last>5000)this.#pending={key:proposal,since:now,last:now};
   else{
    this.#pending.last=now;
    if(now-this.#pending.since>=TABLE_SETTLE_MS){
     if(!desired.size)this.reset();
     else if(desired.size<=144){this.#owners=new Map(desired);this.#pending=null;}
    }
   }
  }
  // A raw-hidden GG window can return with the same identity while its size
  // query temporarily fails. Keep its last verified constraints, bounded.
  for(const map of [this.#minimums,this.#arrival]){
   for(const k of map.keys())if(!this.#owners.has(k)&&!desired.has(k)&&!native.has(k)){
    const [pid,id]=k.split(':').map(Number);let dead=false;
    try{dead=adapter.isAlive({pid,id})===false;}catch{}
    if(dead)map.delete(k);
   }
   while(map.size>512){const stale=[...map.keys()].find(k=>!this.#owners.has(k)&&!desired.has(k));if(!stale)break;map.delete(stale);}
  }
  const plan=this.#geometry(monitor,profile);
  if(!this.active){
   if(!gg.length&&visible.length&&!this.#plan)return {plan:null,layoutWindows:visible};
   return {plan:gg.length?unavailable('Waiting for verified GG table metadata.'):null,layoutWindows:[]};
  }
  return {plan,layoutWindows:gg.filter(w=>this.#owners.has(key(w))&&positive(w))};
 }
}
