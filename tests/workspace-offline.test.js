// No native libraries or Electron: these tests exercise production planners
// and managers against in-memory windows only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePokerWorkspace} from '../src/poker-workspace.js';
import {TableLayoutManager} from '../src/table-layout-manager.js';
import {WorkspaceManager} from '../src/workspace-manager.js';

function fakeWindow(id,title,bounds){
  let current={...bounds};
  return {id,processId:42,path:'C:\\offline-fixture\\GGnet.exe',title,moves:0,
    getTitle(){return this.title;},getBounds:()=>({...current}),setBounds(next){current={...next};this.moves++;}};
}
const config={enabled:true,autoArrange:true,lockLayout:true,arrangeOnStartup:true,profiles:[{id:'default',monitorId:'primary',rows:0,columns:0,gap:0,margin:0}]};
const work={x:0,y:0,width:3840,height:2112};

for(const [count,width,height,rows,compact=false] of [[4,1467,1047,2],[6,982,702,2],[6,1103,788,2,true],[9,978,698,3],[12,739,528,4]]){
  test(`offline ${count} tables${compact?' compact replay':''}: exact uniform packing, high stakes left, stable tools and magnetic return`,()=>{
    const monitor={id:1,isValid:()=>true,isPrimary:()=>true,getBounds:()=>work,getWorkArea:()=>work,getScaleFactor:()=>1};
    const tables=Array.from({length:count},(_,i)=>fakeWindow(i+1,i===count-1?'NLH Gold 08':'Rush & Cash - $0.10 / $0.25',{x:50,y:50,width:800,height:600}));
    const options=compact?{replayMinimum:{width:652,height:528}}:{preferSixReviewLayout:true};
    let plan=calculatePokerWorkspace(work,count,options);
    const manager=new TableLayoutManager({windowManager:{getMonitors:()=>[monitor]},getLayoutWorkArea:()=>plan.tableArea,getLayoutTargets:()=>plan.tableRects});
    assert.equal(manager.maybeArrange(tables,config),true);
    const originX=count===6&&!compact?447:0;
    assert.deepEqual(tables[count-1].getBounds(),{x:originX,y:0,width,height});
    const expected=[tables[count-1],...tables.slice(0,count-1)].map((_,i)=>({x:originX+Math.floor(i/rows)*width,y:(i%rows)*height,width,height}));
    assert.deepEqual([tables[count-1],...tables.slice(0,count-1)].map(w=>w.getBounds()),expected);
    const placed=tables.map(w=>w.getBounds()),moves=tables.map(w=>w.moves);
    const tools=['Bankroll Challenge Information','Player Example','HH  Rush & Cash $0.10 / $0.25'].map((title,i)=>fakeWindow(100+i,title,{x:30,y:30,width:400,height:600}));
    const info=[{min:{width:424,height:600},max:{width:424,height:600}},
      {className:'ApolloRuntimeContentWindow',min:{width:404,height:582},max:{width:404,height:582}},
      {min:{width:compact?652:898,height:compact?528:700},max:{width:compact?652:898,height:2160}}];
    if(count===6&&!compact){tools.push(fakeWindow(103,'HH  Rush & Cash $0.10 / $0.25',{x:30,y:30,width:898,height:700}));info.push(info[2]);}
    let dragging=false;
    const utilities=new WorkspaceManager({adapter:{visible:()=>true,inspect:w=>info[w.id-100],bounds:w=>w.getBounds(),isDragging:()=>dragging,
      place:(w,r)=>w.setBounds(r)}});
    utilities.sync(tools,plan,0);
    const toolBounds=tools.map(w=>w.getBounds());
    assert.equal(toolBounds[0].width,424);assert.equal(toolBounds[0].height,600);
    assert.equal(toolBounds[1].width,404);assert.equal(toolBounds[1].height,582);
    assert.equal(toolBounds[2].width,compact?652:898);assert.ok(toolBounds[2].height>=(compact?528:700));
    if(tools.length===4)assert.deepEqual(toolBounds[2],toolBounds[3],'all replayers share the same compact region');
    tools[0].setBounds({...toolBounds[0],x:10,y:10});
    utilities.sync(tools,plan,100);dragging=true;utilities.sync(tools,plan,500);
    assert.equal(tools[0].getBounds().x,10);
    dragging=false;utilities.sync(tools,plan,700);
    assert.deepEqual(tools[0].getBounds(),toolBounds[0]);
    utilities.sync([],plan,800);plan=calculatePokerWorkspace(work,count,options);manager.maybeArrange(tables,config);
    utilities.sync(tools,plan,1000);manager.maybeArrange(tables,config);
    assert.deepEqual(tables.map(w=>w.getBounds()),placed);
    assert.deepEqual(tables.map(w=>w.moves),moves,'tool open/close or drag must never move a table');
  });
}
