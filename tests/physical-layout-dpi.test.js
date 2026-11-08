import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePokerWorkspace} from '../src/poker-workspace.js';
test('automatic 4K table geometry is unchanged by Windows text scaling',()=>{
 const work={x:0,y:0,width:3840,height:2088};
 for(const count of [4,5,6,8,9]){
  const base=calculatePokerWorkspace(work,count,{automaticPolicy:true,scaleFactor:1});
  const scaled=calculatePokerWorkspace(work,count,{automaticPolicy:true,scaleFactor:1.5});
  assert.equal(scaled.mode,'full');
  assert.deepEqual(scaled.tableRects,base.tableRects,`count ${count}`);
  assert.deepEqual(scaled.slots,base.slots);
  assert.equal(scaled.scaleFactor,1.5,'retain actual display DPI for native compatibility checks');
 }
});


test('twelve at 150% falls back to a non-overlapping grid and clock when full tools cannot fit',()=>{
 const p=calculatePokerWorkspace({x:0,y:0,width:3840,height:2088},12,{automaticPolicy:true,scaleFactor:1.5});
 assert.equal(p.mode,'full');assert.equal(p.tableRects.length,12);assert.equal(p.toolsLimited,true);
 for(const r of p.tableRects){assert.ok(r.width>=840&&r.height>=622.5);for(const s of Object.values(p.slots))assert.ok(r.x+r.width<=s.x||s.x+s.width<=r.x||r.y+r.height<=s.y||s.y+s.height<=r.y);}
 assert.ok(p.slots.clock);assert.equal(p.slots.replay,undefined);
});
