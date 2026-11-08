import {classifyPokerUtility,isGgProcess,fitPokerUtilitySlot} from './poker-workspace.js';

export class WorkspaceManager {
  constructor({adapter,error=()=>{}}){this.adapter=adapter;this.error=error;this.assigned=new Map();this.drift=new Map();this.bindings=new Map();this.capacityErrors=new Map();}
  sync(windows,plan,now=Date.now()){
    if(!plan){this.assigned.clear();this.drift.clear();this.bindings.clear();this.capacityErrors.clear();return;}
    const records=[],seen=new Set();
    for(const win of windows){
      try{
        if(!isGgProcess(win)||!this.adapter.visible(win))continue;
        const info=this.adapter.inspect(win),role=classifyPokerUtility(win,info);
        if(!role)continue;
        const keys=Object.keys(plan.slots).filter(k=>k===role||new RegExp(`^${role}[2-9]$`).test(k));
        if(!keys.length)continue;
        const identity=JSON.stringify([win.processId,win.path,role]);
        const shared=Array.isArray(plan.sharedRoles)&&plan.sharedRoles.includes(role);
        records.push({win,info,role,keys,identity,shared});seen.add(win.id);
      }catch(error){this.error(error);}
    }
    for(const map of [this.bindings,this.assigned,this.drift,this.capacityErrors])for(const id of map.keys())if(!seen.has(id))map.delete(id);
    const used=new Set();
    // Reserve all existing owners before allocating newly opened windows. A
    // change in focus/z-order must never let a new replay steal another's slot.
    for(const r of records){
      const binding=this.bindings.get(r.win.id);
      if(binding&&binding.identity===r.identity&&r.keys.includes(binding.slotKey)&&(r.shared||!used.has(binding.slotKey))&&
        fitPokerUtilitySlot(plan.slots[binding.slotKey],r.info,plan.scaleFactor))used.add(binding.slotKey);
      else this.bindings.delete(r.win.id);
    }
    records.sort((a,b)=>Number(a.win.id)-Number(b.win.id));
    for(const {win,info,role,keys,identity,shared} of records){
      try{
        let binding=this.bindings.get(win.id);
        if(!binding){
          const slotKey=keys.find(k=>(shared||!used.has(k))&&fitPokerUtilitySlot(plan.slots[k],info,plan.scaleFactor));
          if(!slotKey){
            const capacityKey=JSON.stringify([identity,keys.map(k=>plan.slots[k])]);
            if(this.capacityErrors.get(win.id)!==capacityKey){this.capacityErrors.set(win.id,capacityKey);this.error(new Error(`No free compatible ${role} slot; window left unchanged.`));}
            this.assigned.delete(win.id);this.drift.delete(win.id);continue;
          }
          binding={identity,slotKey,pid:win.processId};this.bindings.set(win.id,binding);used.add(slotKey);
        }
        this.capacityErrors.delete(win.id);
        const slot=fitPokerUtilitySlot(plan.slots[binding.slotKey],info,plan.scaleFactor);
        const key=JSON.stringify([identity,binding.slotKey,slot]);
        const current=this.adapter.bounds(win);
        if(Object.keys(slot).every(k=>Math.abs(current[k]-slot[k])<=2)){
          this.assigned.set(win.id,key);this.drift.delete(win.id);continue;
        }
        if(this.assigned.get(win.id)===key){
          const boundsKey=JSON.stringify(current),previous=this.drift.get(win.id);
          if(previous?.boundsKey!==boundsKey){this.drift.set(win.id,{boundsKey,changed:now});continue;}
          if(this.adapter.isDragging?.(win)||now-previous.changed<250)continue;
        }
        if(this.adapter.place(win,slot,info,plan.scaleFactor)!==false){this.assigned.set(win.id,key);this.drift.delete(win.id);}
      }catch(error){this.error(error);}
    }
  }
}
