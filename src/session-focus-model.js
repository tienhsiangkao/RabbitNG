const clean=(value,max=160,multiline=false)=>typeof value==='string'?Array.from(value.replace(multiline?/\r/g:/[\r\n\t]+/g,' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'')).slice(0,max).join(''):'';
const fields=['position','pot','street','action','cue'];
const drill=(raw={},fallback='')=>({...Object.fromEntries([...fields.map(k=>[k,clean(raw?.[k],k==='cue'?90:80)]),['detail',clean(typeof raw?.detail==='string'?raw.detail:fallback,2400,true)]]),
 evidence:['personal','population','testing'].includes(raw?.evidence)?raw.evidence:'testing',state:['practice','review','parked'].includes(raw?.state)?raw.state:'practice'});
export function normalizeSessionFocus(raw={}){
 const modular=Array.isArray(raw?.drills)&&raw.drills.length>0;
 const count=modular?Math.max(5,Math.min(20,raw.drills.length)):5;
 const lines=Array.from({length:count},(_,i)=>clean(Array.isArray(raw?.lines)?raw.lines[i]:''));
 const result={enabled:raw?.enabled!==false,lines,active:Number.isInteger(raw?.active)?Math.max(0,Math.min(count-1,raw.active)):0,revision:Number.isSafeInteger(raw?.revision)&&raw.revision>=0?raw.revision:0};
 if(modular){result.drills=Array.from({length:count},(_,i)=>drill(raw.drills[i],lines[i]));result.lines=result.drills.map(d=>clean(d.detail));}
 if(Array.isArray(raw?.selected)){
  result.selected=[...new Set(raw.selected.filter(i=>Number.isInteger(i)&&i>=0&&i<count&&result.drills?.[i]?.state!=='parked'))].slice(0,3);
  if(result.selected.length&&!result.selected.includes(result.active))result.active=result.selected[0];
 }
 return result;
}
export function patchSessionFocus(current,patch={}){
 const next=normalizeSessionFocus(current);if(!patch||typeof patch!=='object')return next;
 if(Array.isArray(patch.drills)&&patch.drills.length){const m=normalizeSessionFocus({...next,drills:patch.drills});Object.assign(next,m);}
 if(patch.drillEdits&&typeof patch.drillEdits==='object'&&next.lines.some((_,i)=>patch.drillEdits[i]&&typeof patch.drillEdits[i]==='object'&&Object.keys(patch.drillEdits[i]).length)){
  if(!next.drills)next.drills=next.lines.map(line=>drill({},line));
  for(let i=0;i<next.drills.length;i++)if(patch.drillEdits[i]&&typeof patch.drillEdits[i]==='object'){
   const old=next.drills[i],changes=patch.drillEdits[i];next.drills[i]=drill({...old,...Object.fromEntries([...fields,'detail','evidence','state'].filter(k=>Object.hasOwn(changes,k)).map(k=>[k,changes[k]]))});
   next.lines[i]=clean(next.drills[i].detail);
  }
 }
 const editLine=(i,value)=>{next.lines[i]=clean(value);if(next.drills)next.drills[i].detail=clean(value,2400,true);};
 if(Array.isArray(patch.lines))for(let i=0;i<next.lines.length;i++)editLine(i,patch.lines[i]);
 if(patch.lineEdits&&typeof patch.lineEdits==='object')for(let i=0;i<next.lines.length;i++)if(Object.hasOwn(patch.lineEdits,i))editLine(i,patch.lineEdits[i]);
 if(typeof patch.enabled==='boolean')next.enabled=patch.enabled;
 if(Number.isInteger(patch.active))next.active=Math.max(0,Math.min(next.lines.length-1,patch.active));
 if(Array.isArray(patch.selected))next.selected=patch.selected;
 next.revision=Math.min(Number.MAX_SAFE_INTEGER,next.revision+1);return normalizeSessionFocus(next);
}
