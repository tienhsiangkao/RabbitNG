// Four supporting windows are small enough to enumerate their slicing
// arrangements. Keep only shapes that are not wider AND taller than another.
export function utilityGroupLayouts(sizes,gap=8) {
  const entries=Object.entries(sizes),memo=new Map();
  const group=mask=>{
    if(memo.has(mask))return memo.get(mask);
    if(!mask)return [{width:0,height:0,slots:{}}];
    if((mask&(mask-1))===0){
      const index=Math.log2(mask),[role,size]=entries[index];
      return [{...size,slots:{[role]:{x:0,y:0,...size}}}];
    }
    const options=[],anchor=mask&-mask;
    for(let left=(mask-1)&mask;left;left=(left-1)&mask){
      if(!(left&anchor))continue;
      const right=mask^left;if(!right)continue;
      for(const a of group(left))for(const b of group(right))for(const horizontal of [true,false]){
        const dx=horizontal?a.width+gap:0,dy=horizontal?0:a.height+gap;
        options.push({width:horizontal?a.width+gap+b.width:Math.max(a.width,b.width),
          height:horizontal?Math.max(a.height,b.height):a.height+gap+b.height,
          slots:{...a.slots,...Object.fromEntries(Object.entries(b.slots).map(([role,r])=>[role,{...r,x:r.x+dx,y:r.y+dy}]))}});
      }
    }
    const frontier=[];
    for(const option of options){
      if(frontier.some(p=>p.width<=option.width&&p.height<=option.height))continue;
      for(let i=frontier.length-1;i>=0;i--)if(option.width<=frontier[i].width&&option.height<=frontier[i].height)frontier.splice(i,1);
      frontier.push(option);
    }
    memo.set(mask,frontier);return frontier;
  };
  return group((1<<entries.length)-1);
}

export function utilityDockPartitions(sizes,gap=8) {
  const roles=Object.keys(sizes),options=[];
  // Every utility goes in exactly one band. Empty bands reserve no space.
  for(let mask=0;mask<(1<<roles.length);mask++){
    const right={},bottom={};
    roles.forEach((role,i)=>{((mask&(1<<i))?right:bottom)[role]=sizes[role];});
    for(const r of utilityGroupLayouts(right,gap))for(const b of utilityGroupLayouts(bottom,gap))options.push({right:r,bottom:b});
  }
  return options;
}
