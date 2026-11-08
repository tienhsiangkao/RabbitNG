import test from 'node:test';
import assert from 'node:assert/strict';
import {utilityGroupLayouts} from '../src/workspace-packing.js';

test('utility groups retain both efficient horizontal and vertical arrangements',()=>{
  const plans=utilityGroupLayouts({a:{width:10,height:20},b:{width:30,height:5}},2);
  assert.deepEqual(plans.map(p=>[p.width,p.height]).sort((a,b)=>a[0]-b[0]),[[30,27],[42,20]]);
  for(const p of plans){
    const [a,b]=Object.values(p.slots);
    assert.ok(a.x+a.width+2<=b.x||b.x+b.width+2<=a.x||a.y+a.height+2<=b.y||b.y+b.height+2<=a.y);
  }
  assert.deepEqual(utilityGroupLayouts({},8),[{width:0,height:0,slots:{}}]);
});
