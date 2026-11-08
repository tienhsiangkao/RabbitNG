const valid=r=>r&&['x','y','width','height'].every(k=>Number.isFinite(r[k]))&&r.width>0&&r.height>0;
const intersects=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
const inside=(a,b)=>a.x>=b.x&&a.y>=b.y&&a.x+a.width<=b.x+b.width&&a.y+a.height<=b.y+b.height;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function sessionFocusRect(work,{tables=[],slots={},actual=[],scaleFactor=1}={}){
 if(!valid(work)||!Number.isFinite(scaleFactor)||scaleFactor<=0||![...tables,...Object.values(slots),...actual].every(valid))return null;
 const gap=Math.ceil(8*scaleFactor),blocks=[],seen=new Set();
 for(const b of [...tables,...Object.values(slots),...actual]){
  const r={x:b.x-gap,y:b.y-gap,width:b.width+gap*2,height:b.height+gap*2};
  const key=JSON.stringify(r);if(!seen.has(key)&&intersects(r,work)){seen.add(key);blocks.push(r);}
 }
 let free=[{...work}];
 for(const b of blocks){
  const split=[];
  for(const r of free){
   if(!intersects(r,b)){split.push(r);continue;}
   if(b.x>r.x)split.push({...r,width:b.x-r.x});
   if(b.x+b.width<r.x+r.width)split.push({...r,x:b.x+b.width,width:r.x+r.width-b.x-b.width});
   if(b.y>r.y)split.push({...r,height:b.y-r.y});
   if(b.y+b.height<r.y+r.height)split.push({...r,y:b.y+b.height,height:r.y+r.height-b.y-b.height});
  }
  free=split.filter((r,i)=>valid(r)&&!split.some((s,j)=>j!==i&&inside(r,s)&&(JSON.stringify(r)!==JSON.stringify(s)||j<i)));
 }
 const clock=slots.clock,anchor=clock?{x:clock.x,y:clock.y+clock.height+gap}:{x:work.x+work.width,y:work.y};
 for(const [w,h]of [[324,400],[280,340]]){
  const width=Math.ceil(w*scaleFactor),height=Math.ceil(h*scaleFactor);
  const below={x:clock?Math.round(clock.x+(clock.width-width)/2):anchor.x,y:anchor.y,width,height};
  if(clock&&inside(below,work)&&!blocks.some(b=>intersects(below,b)))return below;
  const candidates=free.filter(r=>r.width>=width&&r.height>=height).map(r=>({
   x:clamp(Math.round(anchor.x),Math.ceil(r.x),Math.floor(r.x+r.width-width)),
   y:clamp(Math.round(anchor.y),Math.ceil(r.y),Math.floor(r.y+r.height-height)),width,height}))
   .filter(r=>inside(r,work)&&!blocks.some(b=>intersects(r,b)));
  candidates.sort((a,b)=>(a.x-anchor.x)**2+(a.y-anchor.y)**2-((b.x-anchor.x)**2+(b.y-anchor.y)**2)||a.y-b.y||a.x-b.x);
  if(candidates.length)return candidates[0];
 }
 return null;
}
