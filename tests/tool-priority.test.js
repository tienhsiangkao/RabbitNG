import test from 'node:test';import assert from 'node:assert/strict';
import {calculatePokerWorkspace} from '../src/poker-workspace.js';
import {ownedPanelLayout} from '../src/owned-panel-layout.js';
const work={x:0,y:0,width:3840,height:2112};
test('right dock puts player notes next to the tables instead of bankroll',()=>{
 for(const n of [1,4,9,12]){const p=calculatePokerWorkspace(work,n,{automaticPolicy:true});assert.ok(p.slots.notes.x<p.slots.challenge.x,String(n));assert.ok(p.slots.notes.y<=p.slots.replay.y);}
});
test('bottom shelf follows notes, replay, focus, clock, bankroll order without smaller tables',()=>{
 for(const n of [5,6]){
  const p=calculatePokerWorkspace(work,n,{automaticPolicy:true});const owned=ownedPanelLayout(work,{tables:p.tableRects,slots:p.slots,preferred:p.ownedPanels});
  const row=[p.slots.notes,p.slots.replay,owned.focus,owned.clock,p.slots.challenge];
  for(let i=1;i<row.length;i++)assert.ok(row[i-1].x+row[i-1].width<=row[i].x,String(n));
  if(n===6)assert.deepEqual([p.tableRects[0].width,p.tableRects[0].height],[1052,752]);
 }
});

test('preferred owned priority slots yield to actual windows without covering them',()=>{
 const p=calculatePokerWorkspace(work,6,{automaticPolicy:true}),blocker={...p.ownedPanels.focus};
 const r=ownedPanelLayout(work,{tables:p.tableRects,slots:p.slots,preferred:p.ownedPanels,actual:[blocker]});
 for(const panel of [r.focus,r.clock].filter(Boolean))assert.ok(panel.x+panel.width<=blocker.x||blocker.x+blocker.width<=panel.x||panel.y+panel.height<=blocker.y||blocker.y+blocker.height<=panel.y);
});
