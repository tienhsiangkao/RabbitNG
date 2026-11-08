import {calculateTileRects,normalizeLayoutProfile} from './table-layout.js';
import {utilityDockPartitions} from './workspace-packing.js';
import {calculateSixShelf} from './six-shelf-layout.js';

export function isGgProcess(win) {
  return /(?:^|[\\/])(?:ggnet|ggpoker|ggpcom|natural8|natural8net)[.]exe$/i.test(String(win.path||win.processPath||''));
}
export function classifyPokerUtility(win,info={}) {
  if(!isGgProcess(win))return null;
  let title;try{title=String(win.getTitle?.()??win.title??'').trim();}catch{return null;}
  if(title==='Bankroll Challenge Information')return 'challenge';
  if(/^HH\s+(?:Rush\s*&\s*Cash|NLH|PLO|Hold.?em)/i.test(title))return 'replay';
  if(!title)return null;
  const close=(a,b)=>Number.isFinite(a)&&Math.abs(a-b)<=2;
  if(info.className==='ApolloRuntimeContentWindow'&&
    close(info.min?.width,404)&&close(info.min?.height,582)&&
    close(info.max?.width,404)&&close(info.max?.height,582))return 'notes';
  return null;
}

export function fitPokerUtilitySlot(region,info={},scale=1) {
  if(!region||!['x','y','width','height'].every(k=>Number.isFinite(region[k]))||!Number.isFinite(scale)||scale<=0)return null;
  const size={};
  for(const key of ['width','height']){
    const minimum=info.min?.[key],maximum=info.max?.[key];
    // Fixed logical sizes can land between physical pixels. Reserve the next
    // whole pixel consistently for both limits; resizable maxima round down.
    const maxPixels=Number.isFinite(maximum)&&maximum>0?
      (maximum===minimum?Math.ceil(maximum*scale):Math.floor(maximum*scale)):region[key];
    size[key]=Math.floor(Math.min(region[key],maxPixels));
    if(size[key]<=0||size[key]<Math.ceil((minimum||0)*scale))return null;
  }
  return {...region,x:region.x+Math.floor((region.width-size.width)/2),...size};
}

export function calculatePokerWorkspace(work,count,{scaleFactor=1,tableMinimum={width:560,height:415},replayMinimum={width:898,height:700},replayCount=1,preferSixReviewLayout=false,automaticPolicy=false,profile={rows:0,columns:0,gap:0,margin:0}}={}) {
  const scale=Number.isFinite(scaleFactor)&&scaleFactor>0?scaleFactor:1;
  const unavailable=()=>({mode:'unavailable',scaleFactor:scale,tableArea:null,tableRects:null,utilities:null,slots:{},
    message:'Equal-size tables and all poker tools cannot fit at their minimum sizes on this display; current positions are preserved.'});
  if(!work||!['x','y','width','height'].every(k=>Number.isFinite(work[k]))||work.width<=0||work.height<=0||
    !Number.isInteger(count)||count<=0||count>144||![1,2].includes(replayCount)||
    !['width','height'].every(k=>Number.isFinite(tableMinimum?.[k])&&tableMinimum[k]>0&&Number.isFinite(replayMinimum?.[k])&&replayMinimum[k]>0))return unavailable();
  work=Object.fromEntries(Object.entries(work).filter(([k])=>['x','y','width','height'].includes(k)).map(([k,v])=>[k,Math.round(v)]));
  // Automatic table geometry is a physical-pixel workspace. Windows text
  // scaling must not enlarge the reserved tool bands and shrink every table.
  // Keep the actual display scale on the plan for native utility size checks.
  const geometryScale=automaticPolicy?1:scale;
  const px=n=>Math.max(1,Math.ceil(n*geometryScale)),gap=px(8);
  const size={challenge:{width:px(424),height:px(600)},notes:{width:px(404),height:px(582)},
    clock:{width:px(324),height:px(192)},replay:{width:px(replayMinimum.width),height:px(replayMinimum.height)}};
  const p=normalizeLayoutProfile(profile);
  if(!automaticPolicy&&preferSixReviewLayout&&count===6&&replayCount===1&&(!p.rows||p.rows===2)&&(!p.columns||p.columns===3)&&!p.gap&&!p.margin){
    if(replayMinimum.width>898||replayMinimum.height>700)return unavailable();
    return calculateSixShelf(work,{scaleFactor:scale,tableMinimum})||unavailable();
  }
  const automaticGrid=automaticPolicy&&!p.rows&&!p.columns
    ? [{rows:2,columns:2},{rows:2,columns:3},{rows:3,columns:3},{rows:3,columns:4}]
      .find(grid=>grid.rows*grid.columns>=count)
    : null;
  if(automaticPolicy&&!p.rows&&!p.columns&&!automaticGrid)return unavailable();
  const capacity=automaticGrid?automaticGrid.rows*automaticGrid.columns:count;
  const candidates=[];
  const add=(area,dock,makeSlots,utilityRegions)=>{
    if(area.width<=0||area.height<=0)return;
    const grids=[];
    if(automaticGrid){
      grids.push(automaticGrid);
    }else if(p.rows||p.columns){
      const columns=p.columns||Math.ceil(count/p.rows);
      grids.push({rows:Math.max(p.rows||1,Math.ceil(count/columns)),columns});
    }else for(let rows=1;rows<=12;rows++){
      const columns=Math.ceil(count/rows);if(columns<=12)grids.push({rows,columns});
    }
    for(const grid of grids){
      if(grid.rows>12||grid.columns>12)continue;
      let rects=calculateTileRects(area,capacity,{...p,...grid},{columnFirst:true,tableAspectRatio:1.4,profileScale:geometryScale});
      const minimumRatio=tableMinimum.width/tableMinimum.height;
      if(automaticPolicy&&minimumRatio>=1.38&&minimumRatio<=1.42&&
        rects.some(r=>r.width<tableMinimum.width*scale||r.height<tableMinimum.height*scale)){
        rects=calculateTileRects(area,capacity,{...p,...grid},{columnFirst:true,tableAspectRatio:minimumRatio,profileScale:geometryScale});
      }
      if(automaticPolicy){
        const left=Math.min(...rects.map(r=>r.x)),occupied=Math.max(...rects.map(r=>r.x+r.width))-left;
        const dx=Math.floor((area.width-occupied)/2)-(left-area.x);
        rects=rects.map(r=>({...r,x:r.x+dx}));
      }
      if(rects.some(r=>r.width<tableMinimum.width*scale||r.height<tableMinimum.height*scale))continue;
      const right=Math.max(...rects.map(r=>r.x+r.width)),bottom=Math.max(...rects.map(r=>r.y+r.height));
      const utilities=dock==='right'?{x:right+gap,y:work.y,width:work.x+work.width-right-gap,height:work.height}:
        dock==='bottom'?{x:work.x,y:bottom+gap,width:work.width,height:work.y+work.height-bottom-gap}:null;
      const slots=makeSlots(utilities);if(!slots)continue;
      const tableArea=automaticPolicy?{x:Math.min(...rects.map(r=>r.x)),y:Math.min(...rects.map(r=>r.y)),
        width:right-Math.min(...rects.map(r=>r.x)),height:bottom-Math.min(...rects.map(r=>r.y))}:{...area};
      candidates.push({mode:'full',scaleFactor:scale,tableArea,tableRects:rects.slice(0,count),grid,dock,utilities,slots,...(utilityRegions?{utilityRegions}:{}),
        score:rects[0].width*rects[0].height,
        message:`${count} equal-size tables with all poker tools visible (${grid.columns} columns × ${grid.rows} rows).`});
    }
  };
  const centered=(x,y,width,s)=>({x:x+Math.floor((width-s.width)/2),y,...s});
  const rightSlots=u=>{
    const {challenge:c,clock:k,notes:n,replay:r}=size;
    if(!automaticPolicy){
      const stackH=k.height+gap+c.height+gap+n.height;
      if(u.width>=r.width+gap+c.width&&u.height>=Math.max(stackH,r.height)){
        const leftWidth=u.width-r.width-gap;
        return {clock:centered(u.x,u.y,leftWidth,k),challenge:centered(u.x,u.y+k.height+gap,leftWidth,c),
          notes:centered(u.x,u.y+k.height+gap+c.height+gap,leftWidth,n),replay:{x:u.x+u.width-r.width,y:u.y,...r}};
      }
      const topH=Math.max(c.height,k.height+gap+n.height);
      if(u.width<Math.max(r.width,c.width+gap+n.width)||u.height<topH+gap+r.height)return null;
      const rightX=u.x+c.width+gap,rightWidth=u.width-c.width-gap;
      return {challenge:{x:u.x,y:u.y,...c},clock:centered(rightX,u.y,rightWidth,k),
        notes:centered(rightX,u.y+k.height+gap,rightWidth,n),replay:{x:u.x,y:u.y+topH+gap,...r}};
    }
    // Use the extra free width beside tall table grids, rather than keeping
    // utilities in a narrow arbitrary rail and leaving the rest unassigned.
    const stackH=n.height+gap+k.height+gap+c.height;
    if(u.width>=r.width+gap+c.width&&u.height>=Math.max(stackH,r.height)){
      const leftWidth=u.width-r.width-gap;
      return {notes:centered(u.x,u.y,leftWidth,n),clock:centered(u.x,u.y+n.height+gap,leftWidth,k),
        challenge:centered(u.x,u.y+n.height+gap+k.height+gap,leftWidth,c),
        replay:{x:u.x+u.width-r.width,y:u.y,width:r.width,height:r.height}};
    }
    const topH=Math.max(n.height,k.height+gap+c.height),replayY=u.y+topH+gap;
    if(u.width<Math.max(r.width,c.width+gap+n.width)||u.height<topH+gap+r.height)return null;
    const rightX=u.x+n.width+gap,rightWidth=u.width-n.width-gap;
    return {notes:{x:u.x,y:u.y,...n},clock:centered(rightX,u.y,rightWidth,k),
      challenge:centered(rightX,u.y+k.height+gap,rightWidth,c),
      replay:{x:u.x,y:replayY,width:r.width,height:r.height}};
  };
  // A bottom dock is useful on wide/short displays. It reserves exactly the
  // same tools and wins only when it allows larger tables than a right dock.
  const bottomSlots=(u,compactReplay=false)=>{
    const roles=automaticPolicy?['notes','replay','clock','challenge']:['challenge','notes','clock','replay'];
    const shelfHeight=Math.max(...roles.filter(role=>!compactReplay||role!=='replay').map(role=>size[role].height));
    if(u.width<roles.reduce((sum,role)=>sum+size[role].width,0)+gap*3||u.height<shelfHeight)return null;
    const packedWidth=roles.reduce((sum,role)=>sum+size[role].width,0)+gap*3;
    let x=u.x+(automaticPolicy?Math.floor((u.width-packedWidth)/2):0);const slots={};
    const y=automaticPolicy?u.y+u.height-shelfHeight:u.y;
    for(const role of roles){slots[role]={x,y,...size[role]};x+=size[role].width+gap;}
    return slots;
  };
  if(replayCount===1){
    add({...work,width:work.width-size.replay.width-gap},'right',rightSlots);
    add({...work,width:work.width-size.replay.width-size.challenge.width-gap*2},'right',rightSlots);
    add({...work,height:work.height-Math.max(...Object.values(size).map(s=>s.height))-gap},'bottom',bottomSlots);
    if(automaticPolicy){
      // User-approved bottom overflow applies only to the replay. Its native
      // size stays intact; the other tools remain fully inside the work area.
      const compactHeight=Math.max(size.clock.height,size.notes.height,size.challenge.height);
      if(compactHeight<size.replay.height)add({...work,height:work.height-compactHeight-gap},'bottom',u=>bottomSlots(u,true));
    }
  }
  // Mixed docks use both free bands rather than reserving one arbitrary rail.
  // Replay dimensions are conservative unless a caller explicitly supplies a
  // different verified native format. Tool visibility is never an input.
  const orderedSizes=automaticPolicy?{notes:size.notes,replay:size.replay,clock:size.clock,challenge:size.challenge}:{clock:size.clock,challenge:size.challenge,notes:size.notes,replay:size.replay};
  if(replayCount===2)orderedSizes.replay2={...size.replay};
  for(const groups of utilityDockPartitions(orderedSizes,gap)){
    const area={...work,width:work.width-(groups.right.width?groups.right.width+gap:0),
      height:work.height-(groups.bottom.height?groups.bottom.height+gap:0)};
    if(area.width<=0||area.height<=0||groups.right.height>work.height||groups.bottom.width>area.width)continue;
    const regions={right:{x:work.x+area.width+gap,y:work.y,width:groups.right.width,height:work.height},
      bottom:{x:work.x,y:work.y+area.height+gap,width:area.width,height:groups.bottom.height}};
    const slots={};
    for(const band of ['right','bottom']){
      const group=groups[band],region=regions[band];
      const dx=region.x+Math.floor((region.width-group.width)/2),dy=region.y;
      for(const [role,r]of Object.entries(group.slots))slots[role]={...r,x:r.x+dx,y:r.y+dy};
    }
    add(area,'mixed',()=>slots,Object.values(regions).filter(r=>r.width>0&&r.height>0));
  }
  if(replayCount===2){
    const r=size.replay,k=size.clock,c=size.challenge,n=size.notes;
    const lowerH=Math.max(c.height,n.height),maxReplayH=px(2160);
    if(c.width+n.width+gap<=r.width&&work.height-lowerH-gap>=r.height&&work.height-k.height-gap>=r.height){
      const area={...work,width:work.width-(2*r.width+gap)-gap};
      const rightX=work.x+work.width-r.width,leftX=rightX-gap-r.width;
      const leftH=Math.min(maxReplayH,work.height-lowerH-gap),rightH=Math.min(maxReplayH,work.height-k.height-gap);
      const rowX=leftX+Math.floor((r.width-c.width-gap-n.width)/2);
      const slots={replay:{x:leftX,y:work.y,width:r.width,height:leftH},
        replay2:{x:rightX,y:work.y+k.height+gap,width:r.width,height:rightH},
        challenge:{x:rowX,y:work.y+leftH+gap,...c},
        notes:{x:rowX+c.width+gap,y:work.y+leftH+gap,...n},
        clock:centered(rightX,work.y,r.width,k)};
      add(area,'right',()=>slots);
    }
  }
  // Stable tie-breaking prefers the right dock, then fewer unused table cells.
  const dockOrder={right:0,bottom:1,mixed:2};
  const utilityArea=p=>Object.values(p.slots).reduce((sum,r)=>sum+r.width*r.height,0);
  candidates.sort((a,b)=>b.score-a.score||utilityArea(b)-utilityArea(a)||dockOrder[a.dock]-dockOrder[b.dock]||a.slots.clock.y-b.slots.clock.y||
    a.grid.rows*a.grid.columns-b.grid.rows*b.grid.columns);
  let toolsLimited=false;
  if(automaticGrid?.rows===3&&automaticGrid.columns===3&&candidates.length){
    const fullTools=candidates[0];
    const fullToolCount=candidates.length;
    const railWidth=Math.max(size.notes.width,size.clock.width);
    add({...work,width:work.width-railWidth-gap},'right',u=>{
      const height=size.notes.height+gap+size.clock.height;
      if(u.width<railWidth||u.height<height)return null;
      return {notes:centered(u.x,u.y,u.width,size.notes),
        clock:centered(u.x,u.y+size.notes.height+gap,u.width,size.clock)};
    });
    const compact=candidates.length>fullToolCount?candidates.pop():null;
    if(compact&&compact.tableRects[0].width>=fullTools.tableRects[0].width*1.1){
      candidates.splice(0,candidates.length,compact);
      toolsLimited=true;
    }
  }
  if(!candidates.length&&automaticPolicy){
    // At high counts native GG minima can leave room for the clock, but
    // not the full notes/challenge/replay windows. Keep tables disjoint;
    // never squeeze them below their verified limits to reserve tools.
    add({...work,height:work.height-size.clock.height-gap},'bottom',u=>{
      if(u.width<size.clock.width||u.height<size.clock.height)return null;
      return {clock:centered(u.x,u.y+u.height-size.clock.height,u.width,size.clock)};
    });
    if(!candidates.length)add(work,'tables-only',()=>({}));
    toolsLimited=candidates.length>0;
  }
  if(!candidates.length)return unavailable();
  let selected=candidates[0];
  if(automaticPolicy){
    // A barely larger table must not buy an extra row or a mostly empty rail.
    // Geometry depends on the current count/constraints, never the prior count.
    const nearBest=candidates.filter(c=>c.score>=selected.score*.95),compactDock={bottom:0,right:1,mixed:2};
    nearBest.sort((a,b)=>(a.grid.rows*a.grid.columns-count)-(b.grid.rows*b.grid.columns-count)||
      a.grid.rows-b.grid.rows||b.score-a.score||compactDock[a.dock]-compactDock[b.dock]);
    selected=nearBest[0];
  }
  if(automaticPolicy&&selected.dock==='bottom'&&!toolsLimited&&replayCount===1){
    // A wide shelf can hold the owned panels in the user's priority order,
    // instead of relegating player notes behind the bankroll window.
    const row={notes:size.notes,replay:size.replay,focus:{width:640,height:592},clock:{width:520,height:308},challenge:size.challenge};
    const width=Object.values(row).reduce((sum,r)=>sum+r.width,0)+gap*4;
    const y=Math.min(...Object.values(selected.slots).map(r=>r.y));
    if(width<=work.width&&y+Math.max(row.notes.height,row.challenge.height,row.focus.height,row.clock.height)<=work.y+work.height){
      let x=work.x+Math.floor((work.width-width)/2);const slots={};
      for(const [role,r]of Object.entries(row)){slots[role]={x,y,...r};x+=r.width+gap;}
      const {focus,...nativeSlots}=slots;
      selected={...selected,slots:nativeSlots,ownedPanels:{focus,clock:slots.clock}};
    }
  }
  if(automaticGrid?.rows===3&&automaticGrid.columns===3&&count===8){
    const [top,middle]=selected.tableRects;
    const last=selected.tableRects[7];
    const empty={...last,y:last.y+middle.y-top.y};
    const replay={x:empty.x,y:empty.y,...size.replay};
    const workBottom=work.y+work.height;
    const otherSlots=Object.entries(selected.slots).filter(([role])=>role!=='replay').map(([,rect])=>rect);
    const intersects=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
    if(replayCount===1&&replay.x+replay.width<=work.x+work.width&&
      replay.y+replay.height<=workBottom+128&&
      ![...selected.tableRects,...otherSlots].some(rect=>intersects(replay,rect))){
      selected={...selected,slots:{...selected.slots,replay}};
    }else if(empty.width>=size.notes.width+gap+size.clock.width&&
      empty.height>=Math.max(size.notes.height,size.clock.height)){
      selected={...selected,slots:{...selected.slots,
        notes:{x:empty.x,y:empty.y,...size.notes},
        clock:{x:empty.x+size.notes.width+gap,y:empty.y,...size.clock}}};
      delete selected.ownedPanels;
    }
  }
  const replayBottomOverflow=Math.max(0,(selected.slots.replay?.y||0)+(selected.slots.replay?.height||0)-(work.y+work.height));
  const {score,...result}=selected;return {...result,...(automaticPolicy?{layout:'automatic-count-grid',workArea:{...work}}:{}),...(toolsLimited?{toolsLimited:true,message:`${count} equal-size tables with a compact tool layout.`}:{}),...(replayBottomOverflow?{replayBottomOverflow,message:`${count} equal-size tables with a compact tool layout. The replayer extends ${replayBottomOverflow} pixels below the work area.`}:{}),sharedRoles:replayCount===1?['replay']:[]};
}
