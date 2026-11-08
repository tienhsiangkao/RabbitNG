import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceManager} from '../src/workspace-manager.js';
import {calculatePokerWorkspace} from '../src/poker-workspace.js';
function fixture(){
  const moves=[];let next=1;
  const make=title=>({id:next++,processId:20,path:'C:\\GG\\GGnet.exe',title,visible:true,bounds:{x:50,y:50,width:424,height:600}});
  const adapter={inspect:w=>w.title==='Bankroll Challenge Information'?{min:{width:424,height:600},max:{width:424,height:600}}:/^HH\s/.test(w.title)?{min:{width:898,height:700},max:{width:898,height:2160}}:{className:'ApolloRuntimeContentWindow',min:{width:404,height:582},max:{width:404,height:582}},
    visible:w=>w.visible,bounds:w=>({...w.bounds}),isDragging:()=>false,place:(w,r)=>{w.bounds={...r};moves.push(w.id)}};
  return {moves,make,adapter,manager:new WorkspaceManager({adapter}),plan:calculatePokerWorkspace({x:0,y:0,width:3840,height:2112},4)};
}
test('utility opening/closing never changes plan and does not interrupt a movement in progress',()=>{
  const f=fixture(),challenge=f.make('Bankroll Challenge Information'),notes=f.make('PlayerOne');
  const before=JSON.stringify(f.plan);f.manager.sync([challenge],f.plan);assert.equal(f.moves.length,1);
  challenge.bounds.x=3000;f.manager.sync([challenge,notes],f.plan);assert.equal(f.moves.length,2);assert.equal(challenge.bounds.x,3000);
  f.manager.sync([challenge],f.plan);assert.equal(f.moves.length,2);assert.equal(JSON.stringify(f.plan),before);
  f.manager.sync([challenge,notes],f.plan);assert.equal(f.moves.length,2,'reopened utility already at its slot is not moved again');
});

test('existing utilities snap back after a completed drag without fighting an active drag',()=>{
  const f=fixture(),w=f.make('Bankroll Challenge Information');
  f.manager.sync([w],f.plan,0);const slot={...w.bounds};
  w.bounds.x=100;f.manager.sync([w],f.plan,100);
  f.adapter.isDragging=()=>true;f.manager.sync([w],f.plan,500);
  assert.equal(w.bounds.x,100);assert.equal(f.moves.length,1);
  w.bounds.x=150;f.manager.sync([w],f.plan,600);
  f.adapter.isDragging=()=>false;f.manager.sync([w],f.plan,700);
  assert.equal(w.bounds.x,150,'wait for a settled drag');
  f.manager.sync([w],f.plan,900);
  assert.deepEqual(w.bounds,slot);assert.equal(f.moves.length,2);
  f.manager.sync([w],f.plan,1500);assert.equal(f.moves.length,2,'unchanged scans do not repeatedly move windows');
  f.manager.sync([w],null,1600);w.bounds.x=25;f.manager.sync([w],null,2000);assert.equal(w.bounds.x,25);
});
test('identity reuse is placed again and unknown or invisible windows are untouched',()=>{
  const f=fixture(),w=f.make('Bankroll Challenge Information');f.manager.sync([w],f.plan);
  w.processId++;w.bounds.x=50;f.manager.sync([w],f.plan);assert.equal(f.moves.length,2);
  const hidden=f.make('HH  Rush & Cash');hidden.visible=false;
  const unknown={...f.make('Other'),path:'C:\\chrome.exe'};f.manager.sync([w,hidden,unknown],f.plan);assert.equal(f.moves.length,2);
});

test('narrow history windows dock at their own native width and still snap back',()=>{
  const f=fixture(),w=f.make('HH  Rush & Cash $0.10 / $0.25');
  f.adapter.inspect=()=>({min:{width:652,height:528},max:{width:652,height:9999}});
  f.manager.sync([w],f.plan,0);
  assert.deepEqual(w.bounds,{x:3065,y:790,width:652,height:700});
  w.bounds.x=100;f.manager.sync([w],f.plan,100);f.manager.sync([w],f.plan,400);
  assert.deepEqual(w.bounds,{x:3065,y:790,width:652,height:700});
});

test('two same-title replayers keep separate slots across focus order, close and reopen',()=>{
  const f=fixture();
  f.plan={scaleFactor:1,slots:{replay:{x:2000,y:0,width:898,height:1000},replay2:{x:2906,y:200,width:898,height:1000}}};
  const a=f.make('HH  Rush & Cash'),b=f.make('HH  Rush & Cash');
  f.manager.sync([a,b],f.plan,0);assert.notDeepEqual(a.bounds,b.bounds);
  const first={...a.bounds},second={...b.bounds};
  f.manager.sync([b,a],f.plan,100);assert.deepEqual(a.bounds,first);assert.deepEqual(b.bounds,second);
  f.manager.sync([b],f.plan,200);assert.deepEqual(b.bounds,second);
  const c=f.make('HH  Rush & Cash');f.manager.sync([c,b],f.plan,300);
  assert.deepEqual(c.bounds,first);assert.deepEqual(b.bounds,second);
  b.bounds.x=100;f.manager.sync([b,c],f.plan,500);f.manager.sync([c,b],f.plan,900);
  assert.deepEqual(b.bounds,second);
});

test('a new utility cannot steal an existing slot and excess tools are not stacked',()=>{
  const f=fixture(),errors=[];f.manager.error=e=>errors.push(e.message);
  f.plan.sharedRoles=[];
  const a=f.make('HH  Rush & Cash');f.manager.sync([a],f.plan,0);const first={...a.bounds};
  const b=f.make('HH  Rush & Cash');f.manager.sync([b,a],f.plan,100);
  assert.deepEqual(a.bounds,first);assert.equal(f.moves.length,1);
  assert.equal(errors.length,1);
  f.manager.sync([b,a],f.plan,500);assert.equal(errors.length,1,'unchanged capacity errors must not spam');
});

test('explicit shared replay region stacks same-size windows exactly without moving settled windows',()=>{
  const f=fixture(),errors=[];f.manager.error=e=>errors.push(e.message);
  f.plan.sharedRoles=['replay'];
  const a=f.make('HH  Rush & Cash'),b=f.make('HH  Rush & Cash');
  f.manager.sync([a,b],f.plan,0);
  assert.deepEqual(a.bounds,b.bounds);assert.equal(f.moves.length,2);assert.equal(errors.length,0);
  f.manager.sync([b,a],f.plan,100);assert.equal(f.moves.length,2,'focus order never triggers positioning/restacking');
  f.manager.sync([b],f.plan,200);assert.equal(f.moves.length,2);
  const c=f.make('HH  Rush & Cash');f.manager.sync([c,b],f.plan,300);
  assert.deepEqual(c.bounds,b.bounds);assert.equal(f.moves.length,3);
  b.bounds.x=50;f.manager.sync([b,c],f.plan,400);f.manager.sync([c,b],f.plan,800);
  assert.deepEqual(c.bounds,b.bounds);assert.equal(f.moves.length,4);
});
