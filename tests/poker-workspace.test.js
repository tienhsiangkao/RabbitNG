import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePokerWorkspace,classifyPokerUtility,fitPokerUtilitySlot} from '../src/poker-workspace.js';

const work={x:0,y:0,width:3840,height:2112};
test('4K workspace packs four, six, nine and twelve equal-size tables with no seams',()=>{
  const plans=[4,6,9,12].map(n=>calculatePokerWorkspace(work,n));
  for(const [i,p] of plans.entries()){
    assert.equal(p.mode,'full');
    const count=[4,6,9,12][i],rects=p.tableRects;
    assert.equal(rects.length,count);
    assert.equal(new Set(rects.map(r=>`${r.width}x${r.height}`)).size,1);
    for(const r of rects){assert.ok(r.width>=560&&r.height>=415);assert.ok(r.x+r.width<=p.utilities.x);}
    const xs=[...new Set(rects.map(r=>r.x))].sort((a,b)=>a-b),ys=[...new Set(rects.map(r=>r.y))].sort((a,b)=>a-b);
    for(let j=1;j<xs.length;j++)assert.equal(xs[j],Math.max(...rects.filter(r=>r.x===xs[j-1]).map(r=>r.x+r.width)));
    for(let j=1;j<ys.length;j++)assert.equal(ys[j],Math.max(...rects.filter(r=>r.y===ys[j-1]).map(r=>r.y+r.height)));
    for(const r of Object.values(p.slots))assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=3840&&r.y+r.height<=2112);
  }
  assert.deepEqual(plans[0].slots,plans[2].slots);
});
test('insufficient space never assigns utility slots that cover tables',()=>{
  for(const n of [4,6,9,12]){
    const p=calculatePokerWorkspace({x:0,y:0,width:1920,height:1040},n);
    assert.equal(p.mode,'unavailable');assert.equal(p.tableArea,null);
    assert.equal(p.tableRects,null);assert.deepEqual(p.slots,{});assert.match(p.message,/minimum|fit/i);
  }
});
test('workspace uses target display scale and negative origins',()=>{
  for(const scale of [1,1.5,2]){
    const p=calculatePokerWorkspace({x:-3840*scale,y:40,width:3840*scale,height:2112*scale},6,{scaleFactor:scale});
    assert.equal(p.mode,'full');assert.equal(p.slots.replay.width,898*scale);
    assert.equal(p.slots.notes.width,404*scale);assert.equal(p.slots.challenge.height,600*scale);
    assert.equal(p.slots.clock.height,192*scale);
  }
  assert.equal(calculatePokerWorkspace(work,4,{scaleFactor:2}).mode,'unavailable','200% scaling has less usable logical room on the same 4K panel');
  assert.equal(calculatePokerWorkspace(work,9,{scaleFactor:2}).mode,'unavailable');
});

test('a narrower history format can fit a supplied region at 150% scaling',()=>{
  const region={x:573,y:0,width:1347,height:1040};
  const narrow=fitPokerUtilitySlot(region,{min:{width:652,height:528},max:{width:652,height:9999}},1.5);
  assert.deepEqual(narrow,{x:757,y:0,width:978,height:1040});
  assert.equal(fitPokerUtilitySlot(region,{min:{width:898,height:700},max:{width:898,height:9999}},1.5),null,'do not shrink the larger format below its native minimum');
});

test('automatic grid fills the height for six and twelve tables instead of wasting the bottom',()=>{
  for(const [count,rows,columns,width,height] of [[4,2,2,1467,1047],[6,3,2,985,704],[9,3,3,978,698],[12,4,3,739,528]]){
    const p=calculatePokerWorkspace(work,count);
    assert.deepEqual(p.grid,{rows,columns});
    assert.equal(p.tableRects[0].width,width);assert.equal(p.tableRects[0].height,height);
    assert.equal(p.dock,'right');
  }
});

test('all utilities are disjoint from each other and every table over display sizes and scaling',()=>{
  let fitted=0;
  for(const [width,height] of [[3840,2112],[3841,2113],[2560,1600],[3440,1400],[1920,1040],[7680,4272]])for(const scale of [1,1.25,1.5,2])for(const count of [1,4,6,9,12]){
    const area={x:-width,y:37,width,height},p=calculatePokerWorkspace(area,count,{scaleFactor:scale});
    if(p.mode==='unavailable'){assert.equal(p.tableRects,null);assert.deepEqual(p.slots,{});continue;}
    fitted++;
    const rects=[...p.tableRects,...Object.values(p.slots)];
    for(const r of rects)assert.ok(r.x>=area.x&&r.y>=area.y&&r.x+r.width<=area.x+width&&r.y+r.height<=area.y+height,JSON.stringify({area,count,scale,r}));
    for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
      const a=rects[i],b=rects[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,JSON.stringify({area,count,scale,a,b}));
    }
    assert.equal(new Set(p.tableRects.map(r=>`${r.width}x${r.height}`)).size,1);
    for(const r of p.tableRects)assert.ok(r.width>=560*scale&&r.height>=415*scale&&Math.abs(r.width/r.height-1.4)<.004);
  }
  assert.ok(fitted>35);
});

test('explicit rows or columns constrain the optimizer and higher native minimums are respected',()=>{
  const fixed=calculatePokerWorkspace(work,6,{profile:{rows:2,columns:3,gap:0,margin:0}});
  assert.deepEqual(fixed.grid,{rows:2,columns:3});
  assert.equal(fixed.tableRects[0].width,982,'a bottom dock fits slightly larger tables while honoring the fixed grid');
  assert.equal(calculatePokerWorkspace(work,6,{profile:{rows:2}}).grid.rows,2);
  assert.equal(calculatePokerWorkspace(work,6,{profile:{columns:3}}).grid.columns,3);
  assert.equal(calculatePokerWorkspace(work,12,{tableMinimum:{width:800,height:600}}).mode,'unavailable');
});

test('malformed work areas, counts and minimums refuse placement',()=>{
  for(const area of [{...work,width:NaN},{...work,height:0},{...work,x:Infinity}])assert.equal(calculatePokerWorkspace(area,4).mode,'unavailable');
  for(const count of [0,-1,1.5,Infinity,145])assert.equal(calculatePokerWorkspace(work,count).mode,'unavailable');
  assert.equal(calculatePokerWorkspace(work,4,{tableMinimum:{width:-1,height:415}}).mode,'unavailable');
});

test('custom profile spacing scales without being reclamped as logical pixels',()=>{
  const p=calculatePokerWorkspace({x:-7680,y:0,width:7680,height:4224},4,{scaleFactor:2,profile:{rows:2,columns:2,gap:80,margin:100}});
  assert.equal(p.mode,'full');
  assert.equal(p.tableRects[1].y-p.tableRects[0].y-p.tableRects[0].height,160);
  assert.equal(p.tableRects[2].x-p.tableRects[0].x-p.tableRects[0].width,160);
  assert.equal(p.tableRects[0].x,-7480);
  assert.equal(p.tableRects[0].y,200);
});

test('utility slots never undercut native minima, including fractional display scaling',()=>{
  const info={min:{width:898,height:700},max:{width:898,height:2160}};
  assert.equal(fitPokerUtilitySlot({x:0,y:0,width:897,height:700},info),null);
  assert.equal(fitPokerUtilitySlot({x:0,y:0,width:898,height:699},info),null);
  assert.equal(fitPokerUtilitySlot({x:0,y:0,width:1122,height:875},info,1.25),null);
  assert.deepEqual(fitPokerUtilitySlot({x:0,y:0,width:1123,height:875},info,1.25),{x:0,y:0,width:1123,height:875});
  const p=calculatePokerWorkspace({x:0,y:0,width:4800,height:2640},6,{scaleFactor:1.25});
  assert.equal(p.mode,'full');assert.equal(p.slots.replay.width,1123);
  assert.ok(fitPokerUtilitySlot(p.slots.replay,info,1.25));
});

test('compact native replay permits six larger tables with tools in separate right and bottom regions',()=>{
  const p=calculatePokerWorkspace(work,6,{replayMinimum:{width:652,height:528}});
  assert.equal(p.mode,'full');assert.equal(p.dock,'mixed');
  assert.deepEqual(p.grid,{rows:2,columns:3});
  assert.deepEqual(p.tableRects[0],{x:0,y:0,width:1103,height:788});
  assert.equal(p.slots.replay.width,652);assert.equal(p.slots.replay.height,528);
  assert.ok(p.slots.replay.y>=1584);
  for(const role of ['clock','challenge','notes'])assert.ok(p.slots[role].x>=3317);
  const rects=[...p.tableRects,...Object.values(p.slots)];
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
    const a=rects[i],b=rects[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
  }
  const baseline=calculatePokerWorkspace(work,6);
  assert.equal(baseline.tableRects[0].width,985,'unknown replay format must retain the conservative default');
  assert.equal(baseline.slots.replay.width,898);
  assert.ok(p.tableRects[0].width*p.tableRects[0].height/(985*704)>1.25);
});

test('malformed replay minimums never enable a hypothetical small-tool layout',()=>{
  for(const replayMinimum of [{width:0,height:528},{width:652,height:NaN},null])
    assert.equal(calculatePokerWorkspace(work,6,{replayMinimum}).mode,'unavailable');
});

test('six-table full-native layout gives both replayers separate tall columns and uses the empty tool area',()=>{
  const p=calculatePokerWorkspace(work,6,{replayCount:2});
  assert.equal(p.mode,'full');assert.deepEqual(p.grid,{rows:3,columns:2});
  assert.deepEqual(p.tableRects[0],{x:0,y:0,width:985,height:704});
  assert.ok(p.slots.replay2,'reserve the second replay even when it is closed');
  for(const role of ['replay','replay2']){
    assert.equal(p.slots[role].width,898);assert.ok(p.slots[role].height>=700&&p.slots[role].height<=2160);
  }
  const rects=[...p.tableRects,...Object.values(p.slots)];
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
    const a=rects[i],b=rects[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
  }
  const occupied=rects.reduce((sum,r)=>sum+r.width*r.height,0)/(3840*2112);
  assert.ok(occupied>.95,`occupied window area should exceed95%, got${occupied}`);
});

test('two full replays remain separate within bounds at multiple display scales and maximum heights',()=>{
  for(const scale of [1,1.25,1.5,2])for(const height of [2112,4000]){
    const area={x:-Math.round(3840*scale),y:50,width:Math.round(3840*scale),height:Math.round(height*scale)};
    const p=calculatePokerWorkspace(area,6,{scaleFactor:scale,replayCount:2});
    assert.equal(p.mode,'full');
    const rects=[...p.tableRects,...Object.values(p.slots)];
    for(const r of rects)assert.ok(r.x>=area.x&&r.y>=area.y&&r.x+r.width<=area.x+area.width&&r.y+r.height<=area.y+area.height);
    for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
      const a=rects[i],b=rects[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
    }
    for(const role of ['replay','replay2'])assert.ok(fitPokerUtilitySlot(p.slots[role],{min:{width:898,height:700},max:{width:898,height:2160}},scale));
  }
});

test('preferred six-table workspace has one short shared replay below a three-by-two playing block',()=>{
  const p=calculatePokerWorkspace(work,6,{preferSixReviewLayout:true});
  assert.equal(p.mode,'full');assert.deepEqual(p.grid,{rows:2,columns:3});
  assert.deepEqual(p.tableRects[0],{x:447,y:0,width:982,height:702});
  assert.deepEqual(p.slots.replay,{x:2059,y:1412,width:898,height:700});
  assert.equal(p.slots.replay2,undefined);assert.deepEqual(p.sharedRoles,['replay']);
  assert.equal(p.slots.clock.y,p.slots.notes.y);assert.equal(p.slots.notes.y,p.slots.challenge.y);
  assert.ok(p.slots.challenge.y>=1412);
  const r=[...p.tableRects,...Object.values(p.slots)];
  for(let i=0;i<r.length;i++)for(let j=i+1;j<r.length;j++){
    const a=r[i],b=r[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
  }
  const custom=calculatePokerWorkspace(work,6,{preferSixReviewLayout:true,profile:{rows:3,columns:2,gap:0,margin:0}});
  assert.deepEqual(custom.grid,{rows:3,columns:2});
});
test('preferred fixed shelf never claims to fit a larger native replay minimum',()=>{
 assert.equal(calculatePokerWorkspace(work,6,{preferSixReviewLayout:true,replayMinimum:{width:1000,height:800}}).mode,'unavailable');
});

test('short shared six-table layout stays inside scaled negative-origin work areas',()=>{
  for(const scale of [1,1.25,1.5,2]){
    const area={x:-Math.round(3840*scale),y:40,width:Math.round(3840*scale),height:Math.round(2112*scale)};
    const p=calculatePokerWorkspace(area,6,{scaleFactor:scale,preferSixReviewLayout:true});
    assert.equal(p.layout,'six-centered-shelf');assert.equal(p.slots.replay.height,Math.ceil(700*scale));
    const rects=[...p.tableRects,...Object.values(p.slots)];
    for(const r of rects)assert.ok(r.x>=area.x&&r.y>=area.y&&r.x+r.width<=area.x+area.width&&r.y+r.height<=area.y+area.height);
    for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
      const a=rects[i],b=rects[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
    }
  }
  const constrained=calculatePokerWorkspace({x:0,y:0,width:1920,height:1040},6,{preferSixReviewLayout:true});
  assert.equal(constrained.mode,'unavailable');
});

test('mixed utility docks preserve bounds and minimum sizes across origins and scaling',()=>{
  for(const scale of [1,1.25,1.5,2])for(const count of [4,6,9,12]){
    const area={x:-Math.round(3840*scale),y:29,width:Math.round(3840*scale),height:Math.round(2112*scale)};
    const p=calculatePokerWorkspace(area,count,{scaleFactor:scale,replayMinimum:{width:652,height:528}});
    assert.equal(p.mode,'full');
    const all=[...p.tableRects,...Object.values(p.slots)];
    for(const r of all)assert.ok(r.x>=area.x&&r.y>=area.y&&r.x+r.width<=area.x+area.width&&r.y+r.height<=area.y+area.height);
    for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
      const a=all[i],b=all[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
    }
    assert.ok(p.slots.replay.width>=Math.ceil(652*scale)&&p.slots.replay.height>=Math.ceil(528*scale));
    assert.ok(fitPokerUtilitySlot(p.slots.replay,{min:{width:652,height:528},max:{width:652,height:9999}},scale));
  }
});
test('native utility roles require verified process and notes size/class, never just a nickname',()=>{
  const win={path:'C:\\GG\\GGnet.exe',title:'MexicanRage'};
  const info={className:'ApolloRuntimeContentWindow',min:{width:404,height:582},max:{width:404,height:582}};
  assert.equal(classifyPokerUtility(win,info),'notes');
  assert.equal(classifyPokerUtility({...win,title:'ExploitKing'},info),'notes');
  assert.equal(classifyPokerUtility({...win,title:'Cashier'},info),'notes','a verified profile can have any player nickname');
  assert.equal(classifyPokerUtility({...win,path:'C:\\app\\chrome.exe'},info),null);
  assert.equal(classifyPokerUtility(win,{...info,min:{width:400,height:400}}),null);
  assert.equal(classifyPokerUtility(win,{...info,className:'OtherWindow'}),null);
  assert.equal(classifyPokerUtility({...win,title:'Bankroll Challenge Information'},{}),'challenge');
  assert.equal(classifyPokerUtility({...win,title:'HH  Rush & Cash $0.10 / $0.25'},{}),'replay');
  assert.equal(classifyPokerUtility({...win,title:'Cashier'},{...info,min:{width:1200,height:720}}),null);
});
