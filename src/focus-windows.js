export class FocusWindows {
  constructor({adapter,isProtected=()=>false,save=()=>{},cookie}) {
    this.adapter=adapter;this.isProtected=isProtected;this.save=save;this.cookie=cookie;this.entries=[];this.active=false;
  }
  enter() {
    if(this.active)return;
    // Retry any incomplete prior recovery before starting another focus pass.
    if(this.entries.length)this.restore();
    if(this.entries.length)throw new Error('Some previous windows still need restoring');
    const windows=this.adapter.list(),protectedIds=new Set();
    const states=new Map();
    for(const win of windows) {
      try {const state=this.adapter.inspect(win);if(state){states.set(state.id,{win,state});if(state.protectOwner){protectedIds.add(state.id);if(state.owner)protectedIds.add(state.owner);}}}catch{}
      try{if(this.isProtected(win))protectedIds.add(win.id);}catch{protectedIds.add(win.id);}
    }
    for(const id of [...protectedIds]) {
      let owner=states.get(id)?.state.owner;const visited=new Set();
      while(owner&&!visited.has(owner)){visited.add(owner);protectedIds.add(owner);owner=states.get(owner)?.state.owner;}
    }
    this.active=true;
    for(const {win,state} of states.values()) {
      if(protectedIds.has(state.id)||!state.eligible||!state.visible||state.minimized)continue;
      const entry={id:state.id,pid:state.pid,path:state.path,cookie:this.cookie,placement:state.placement};
      let tagged=false;
      try {
        tagged=this.adapter.tag(win,entry.cookie);
        if(!tagged)continue;
        // Never minimize a window until recovery information is durable.
        const next=[...this.entries,entry];this.save(next);this.entries=next;
      }catch(error){if(tagged)this.adapter.untag(win);this.active=false;throw error;}
      let minimized=false;
      try{minimized=this.adapter.minimize(win);}catch{}
      if(!minimized){this.adapter.untag(win);this.entries=this.entries.filter(e=>e!==entry);this.save(this.entries);}
    }
  }
  restore(saved=this.entries) {
    this.active=false;
    // Seed pending recovery before enumeration: a failed native read must not
    // make the next Playing pass overwrite the still-needed on-disk journal.
    this.entries=[...saved];
    const windows=new Map(this.adapter.list().map(w=>[w.id,w]));
    const remaining=[...this.entries];
    for(const entry of [...this.entries].reverse()) {
      try {
        const win=windows.get(entry.id),state=win?this.adapter.inspect(win):null;
        const matches=state&&state.pid===entry.pid&&state.path===entry.path&&this.adapter.hasTag(win,entry.cookie);
        if(matches) {
          if(state.minimized&&!this.adapter.restore(win,entry.placement))continue;
          this.adapter.untag(win);
        }
        remaining.splice(remaining.indexOf(entry),1);
      }catch{/* Keep this entry pending and still restore the other windows. */}
    }
    this.entries=remaining;this.save(remaining);
  }
}
