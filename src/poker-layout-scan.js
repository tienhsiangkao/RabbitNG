import {calculatePokerWorkspace,isGgProcess} from './poker-workspace.js';
import {stakeBadgeForTitle} from './table-stakes.js';

// Shared by the actual scanner and Node simulations. Adapter methods are injected.
export function preparePokerLayoutScan({tables,nativeWindows,session,adapter,monitor,profile,now=performance.now(),mixedPresence=false}){
 if(session.kind==='automatic-counts')return session.prepare({tables,nativeWindows,adapter,monitor,profile,now,mixedPresence});
 const visible=tables.filter(win=>{try{return adapter.visible(win)===true;}catch{return false;}});
 const gg=visible.filter(isGgProcess);
 const compatible=(!profile.rows||profile.rows===2)&&(!profile.columns||profile.columns===3)&&!profile.gap&&!profile.margin;
 if(!session.active&&gg.length!==6&&gg.length!==visible.length)return {plan:null,layoutWindows:visible};
 if(compatible&&(session.active||gg.length===6)){
  const destroyed=session.reservations.filter(identity=>{
   if(nativeWindows.some(win=>win.id===identity.id&&win.processId===identity.pid))return false;
   try{return adapter.isAlive(identity)===false;}catch{return false;}
  });
  const inactive=[...destroyed],visibleKeys=new Set(gg.map(w=>`${w.processId}:${w.id}`));
  const states=new Map();
  const readState=win=>{
   const key=`${win.processId}:${win.id}`;
   if(!states.has(key)){try{states.set(key,adapter.layoutState?.(win));}catch{states.set(key,null);}}
   return states.get(key);
  };
  const survivorsKnown=gg.every(win=>{
   if(!nativeWindows.some(w=>w.id===win.id&&w.processId===win.processId))return false;
   const state=readState(win);return state?.nativeVisible===true&&state.minimized===false&&state.cloaked===false;
  });
  for(const identity of session.reservations){
   if(visibleKeys.has(`${identity.pid}:${identity.id}`))continue;
   const win=nativeWindows.find(w=>w.id===identity.id&&w.processId===identity.pid);if(!win)continue;
   try{
    const state=readState(win);
    if(state?.nativeVisible===false&&state.minimized===false&&state.cloaked===false)inactive.push(identity);
   }catch{} // Unknown state cannot authorize a layout change.
  }
  const reflow=session.shouldRetile({visible:gg.map(w=>({id:w.id,pid:w.processId})),inactive,
   enabled:!profile.rows&&!profile.columns&&visible.length===gg.length&&survivorsKnown,now});
  if(reflow)session.reset({preserveMinimums:true});
  const records=gg.map(win=>{
   let minimum;try{minimum=adapter.inspect(win).min;}catch{}
   return {id:win.id,pid:win.processId,level:stakeBadgeForTitle(win.getTitle?.()||'')?.level||0,visible:true,minimum};
  });
  const plan=reflow?null:session.update(records,{workArea:monitor.workArea,scaleFactor:monitor.scaleFactor,destroyed});
  if(plan){
   const owners=new Set(session.reservations.map(r=>`${r.pid}:${r.id}`));
   return {plan,layoutWindows:gg.filter(w=>owners.has(`${w.processId}:${w.id}`))};
  }
 }else if(session.active)session.reset({preserveMinimums:true});
 const records=visible.map(win=>{
  let minimum;try{minimum=adapter.inspect(win).min;}catch{}
  return {id:win.id,pid:win.processId,minimum};
 });
 const tableMinimum=session.tableMinimumFor(records);
 return {plan:calculatePokerWorkspace(monitor.workArea,visible.length,{scaleFactor:monitor.scaleFactor,tableMinimum,profile,preferSixReviewLayout:true}),layoutWindows:visible};
}
