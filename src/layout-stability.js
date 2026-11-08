const geometry=r=>r&&['x','y','width','height'].every(k=>Number.isFinite(r[k]))?
 Object.fromEntries(['x','y','width','height'].map(k=>[k,r[k]])):null;
const key=r=>`${r.pid}:${r.id}`;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const roles=new Set(['table','notes','challenge','replay']);
function windowRecord(r){
 if(!Number.isSafeInteger(r?.id)||r.id<=0||!Number.isSafeInteger(r.pid)||r.pid<=0||!roles.has(r.role))return null;
 return {id:r.id,pid:r.pid,role:r.role,present:r.present!==false,
  visible:typeof r.visible==='boolean'?r.visible:null,minimized:typeof r.minimized==='boolean'?r.minimized:null,
  bounds:geometry(r.bounds),overlays:r.role==='table'?Object.fromEntries(['rng','stakes','clock','frame'].map(k=>[k,r.overlays?.[k]===true])):null};
}
function planRecord(p){
 if(!p)return null;
 return {mode:['full','compact','unavailable'].includes(p.mode)?p.mode:'other',
  layout:['six-centered-shelf','automatic-count-grid'].includes(p.layout)?p.layout:'other',
  scaleFactor:Number.isFinite(p.scaleFactor)?p.scaleFactor:null,
  tableRects:Array.isArray(p.tableRects)?p.tableRects.slice(0,12).map(geometry):null,
  slots:Object.fromEntries(['clock','notes','challenge','replay'].filter(k=>p.slots?.[k]).map(k=>[k,geometry(p.slots[k])]))};
}

// Local rolling diagnostics, not session history. No native APIs or write authority.
export class LayoutStabilityJournal {
 #windows=new Map();#events=[];#plan=undefined;#sequence=0;#dropped=0;#scans=0;#lastAt=null;
 constructor({limit=200,maxWindows=128}={}){
  this.limit=Number.isSafeInteger(limit)?Math.max(1,Math.min(500,limit)):200;
  this.maxWindows=Number.isSafeInteger(maxWindows)?Math.max(1,Math.min(256,maxWindows)):128;
 }
 #push(type,before,after,at){
  this.#events.push({sequence:++this.#sequence,at,type,before,after});
  if(this.#events.length>this.limit){this.#events.shift();this.#dropped++;}
 }
 identities(){return [...this.#windows.values()].map(({id,pid,role})=>({id,pid,role}));}
 observe(records,plan,at=Date.now()){
  this.#scans++;this.#lastAt=Number.isFinite(at)?at:null;const before=this.#sequence,seen=new Set();
  for(const input of Array.isArray(records)?records:[]){
   const r=windowRecord(input);if(!r||seen.has(key(r)))continue;const k=key(r);seen.add(k);
   const previous=this.#windows.get(k);
   if(!equal(previous,r))this.#push(!previous?'window-observed':previous.present===false&&r.present?'window-returned':'window-changed',previous??null,r,this.#lastAt);
   this.#windows.delete(k);this.#windows.set(k,r);
  }
  for(const [k,r]of this.#windows)if(!seen.has(k)&&r.present){
   const missing={...r,present:false,visible:null,minimized:null,overlays:null};
   this.#push('window-missing',r,missing,this.#lastAt);this.#windows.set(k,missing);
  }
  while(this.#windows.size>this.maxWindows)this.#windows.delete(this.#windows.keys().next().value);
  const next=planRecord(plan);
  if(!equal(this.#plan,next)){this.#push('workspace-changed',this.#plan??null,next,this.#lastAt);this.#plan=next;}
  return before!==this.#sequence;
 }
 snapshot(){return structuredClone({version:1,scans:this.#scans,lastObservedAt:this.#lastAt,droppedEvents:this.#dropped,
  windows:[...this.#windows.values()],workspace:this.#plan??null,events:this.#events});}
}
