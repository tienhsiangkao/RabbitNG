import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePokerWorkspace} from '../src/poker-workspace.js';
const work={x:0,y:0,width:3840,height:2112};
test('automatic six-table shelf grows tables and overflows only the replayer bottom',()=>{
 const p=calculatePokerWorkspace(work,6,{automaticPolicy:true});
 assert.equal(p.mode,'full');assert.ok(p.tableRects[0].width>982);
 assert.equal(p.slots.replay.height,700);assert.ok(p.slots.replay.y+p.slots.replay.height>2112);
 for(const [role,r]of Object.entries(p.slots)){
  assert.ok(r.x>=0&&r.x+r.width<=3840);assert.ok(r.y>=0);
  if(role!=='replay')assert.ok(r.y+r.height<=2112);
  for(const b of p.tableRects)assert.ok(r.x+r.width<=b.x||b.x+b.width<=r.x||r.y+r.height<=b.y||b.y+b.height<=r.y);
 }
 assert.equal(p.replayBottomOverflow,100);
});
test('manual layout keeps the complete replay window within the screen',()=>{
 const p=calculatePokerWorkspace(work,6);assert.ok(p.slots.replay.y+p.slots.replay.height<=2112);assert.equal(p.replayBottomOverflow,undefined);
});
