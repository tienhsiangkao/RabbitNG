// No native prototype or raw handle object escapes this facade.
export function guardLiveWindow(real,{gate,adapter,beforeWrite=()=>{},writePhysical,onViolation,onWrite}){
 const facade=Object.create(null),identity=Object.freeze({id:real.id,pid:real.processId,path:real.path});
 Object.assign(facade,{id:identity.id,processId:identity.pid,path:identity.path});
 for(const name of ['getBounds','getTitle','getMonitor','isWindow','isVisible','isMinimized','getOpacity','getClassName']){
  if(typeof real[name]==='function')facade[name]=(...args)=>real[name](...args);
 }
 const deny=()=>{const error=Error('Live test blocks this native window operation');onViolation(error);throw error;};
 for(const name of ['bringToTop','minimize','maximize','restore','show','hide','close','destroy','redraw','setOwner','setOpacity','toggleTransparency','getOwner'])facade[name]=deny;
 facade.setBounds=rect=>{
  try{
   beforeWrite();
   const access=adapter();
   if(!access.visible(real)||access.isAlive(identity)!==true)throw Error('Target lost native eligibility before placement');
   const scale=real.getMonitor?.()?.getScaleFactor?.();
   if(!Number.isFinite(scale)||scale<=0)throw Error('Unknown native scale');
   const physical=Object.fromEntries(['x','y','width','height'].map(k=>[k,Math.floor(rect[k]*scale)]));
   gate.allowWrite(identity,physical);
   // NWM's setter reads scale again. Pass the frozen approved pixels directly.
   writePhysical(identity,physical);onWrite(identity,physical);
  }catch(error){onViolation(error);throw error;}
 };
 return Object.freeze(facade);
}
