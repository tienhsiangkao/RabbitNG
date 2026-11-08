const valid=r=>r&&['x','y','width','height'].every(k=>Number.isFinite(r[k]))&&r.width>0&&r.height>0;
const hit=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
const inside=(a,b)=>a.x>=b.x&&a.y>=b.y&&a.x+a.width<=b.x+b.width&&a.y+a.height<=b.y+b.height;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function regions(work,blocks,gap){
 let free=[{...work}];
 for(const rect of blocks){
  const b={x:rect.x-gap,y:rect.y-gap,width:rect.width+2*gap,height:rect.height+2*gap},split=[];
  for(const r of free){
   if(!hit(r,b)){split.push(r);continue;}
   if(b.x>r.x)split.push({...r,width:b.x-r.x});
   if(b.x+b.width<r.x+r.width)split.push({...r,x:b.x+b.width,width:r.x+r.width-b.x-b.width});
   if(b.y>r.y)split.push({...r,height:b.y-r.y});
   if(b.y+b.height<r.y+r.height)split.push({...r,y:b.y+b.height,height:r.y+r.height-b.y-b.height});
  }
  free=split.filter((r,i)=>valid(r)&&!split.some((s,j)=>j!==i&&inside(r,s)&&(JSON.stringify(r)!==JSON.stringify(s)||j<i)));
 }
 return free;
}
const focusSizes=[[640,592],[520,560],[440,500],[360,440],[324,400],[280,340]];
const clockSizes=[[520,308],[440,261],[380,225],[324,192]];
export function ownedPanelLayout(work,{tables=[],slots={},actual=[],scaleFactor=1,fixedClock=null,focusEnabled=true,clockEnabled=true,preferred=null}={}){
 const none={clock:null,focus:null};
 const tools=Object.entries(slots).filter(([role])=>role!=='clock').map(([,r])=>r);
 const blocks=[...tables,...tools,...actual];
 if(!valid(work)||!Number.isFinite(scaleFactor)||scaleFactor<=0||!blocks.every(valid)||(slots.clock&&!valid(slots.clock))||(fixedClock&&!valid(fixedClock)))return none;
 const gap=Math.ceil(8*scaleFactor),free=regions(work,blocks,gap);
 const anchor=fixedClock||slots.clock||{x:work.x+work.width/2,y:work.y+work.height/2};
 const place=(region,width,height)=>({x:clamp(Math.round(anchor.x),Math.ceil(region.x),Math.floor(region.x+region.width-width)),
  y:clamp(Math.round(anchor.y),Math.ceil(region.y),Math.floor(region.y+region.height-height)),width,height});
 const distance=r=>(r.x-anchor.x)**2+(r.y-anchor.y)**2;
 const singles=(areas,sizes)=>sizes.flatMap(([w,h])=>areas.filter(r=>r.width>=w&&r.height>=h).map(r=>place(r,w,h)));
 if(preferred&&!fixedClock){
  const focus=focusEnabled?preferred.focus:null,clock=clockEnabled?preferred.clock:null;
  const chosen=[focus,clock].filter(Boolean);
  const complete=(!focusEnabled||!!focus)&&(!clockEnabled||!!clock);
  if(complete&&chosen.every(r=>valid(r)&&free.some(area=>inside(r,area)))&&
    (!focus||!clock||!hit({...focus,x:focus.x-gap,y:focus.y-gap,width:focus.width+2*gap,height:focus.height+2*gap},clock)))return {focus,clock};
 }
 if(!clockEnabled)return {clock:null,focus:focusEnabled?singles(free,focusSizes).sort((a,b)=>b.width*b.height-a.width*a.height||distance(a)-distance(b))[0]||null:null};
 if(fixedClock){
  const focus=focusEnabled?singles(regions(work,[...blocks,fixedClock],gap),focusSizes).sort((a,b)=>b.width*b.height-a.width*a.height||distance(a)-distance(b))[0]||null:null;
  return {clock:{...fixedClock},focus};
 }
 const pairs=[];
 if(focusEnabled)for(const [fw,fh]of focusSizes)for(const [cw,ch]of clockSizes)for(const stacked of [false,true]){
  const width=stacked?Math.max(fw,cw):fw+gap+cw,height=stacked?fh+gap+ch:Math.max(fh,ch);
  for(const r of free){
   if(r.width<width||r.height<height)continue;
   const group=place(r,width,height);
   const focus={x:group.x,y:group.y+(stacked?ch+gap:0),width:fw,height:fh};
   const clock={x:group.x+(stacked?Math.floor((width-cw)/2):fw+gap),y:group.y,width:cw,height:ch};
   pairs.push({clock,focus,score:fw*fh+cw*ch,distance:distance(clock)});
  }
 }
 pairs.sort((a,b)=>b.score-a.score||a.distance-b.distance||a.clock.y-b.clock.y||a.clock.x-b.clock.x);
 // Separate free regions can still accommodate both panels. Try all clock
 // choices, reserving its actual footprint before placing the notebook.
 const alternatives=[...pairs];
 for(const clock of singles(free,clockSizes)){
  const focus=focusEnabled?singles(regions(work,[...blocks,clock],gap),focusSizes).sort((a,b)=>b.width*b.height-a.width*a.height||distance(a)-distance(b))[0]||null:null;
  alternatives.push({clock,focus,score:(focus?focus.width*focus.height:0)+clock.width*clock.height});
 }
 alternatives.sort((a,b)=>Number(!!b.focus)-Number(!!a.focus)||b.score-a.score||distance(a.clock)-distance(b.clock));
 if(alternatives.length)return {clock:alternatives[0].clock,focus:alternatives[0].focus};
 return none;
}
