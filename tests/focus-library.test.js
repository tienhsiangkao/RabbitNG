import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeSessionFocus,patchSessionFocus} from '../src/session-focus-model.js';
test('playing selection is at most three valid unique drills and current highlight belongs to it',()=>{
 let m=normalizeSessionFocus({selected:[3,3,1,99,0,4],active:4});assert.deepEqual(m.selected,[3,1,0]);assert.equal(m.active,3);
 m=patchSessionFocus(m,{selected:[4,2],active:2});assert.deepEqual(m.selected,[4,2]);assert.equal(m.active,2);
 assert.deepEqual(patchSessionFocus(m,{selected:[]}).selected,[]);
});
test('evidence is conservative and parking removes a drill from the playing selection',()=>{
 let m=normalizeSessionFocus({drills:[{detail:'A',evidence:'personal'},{detail:'B',evidence:'population'},{detail:'C',evidence:'nonsense'}],selected:[0,1,2]});
 assert.equal(m.drills[2].evidence,'testing');
 m=patchSessionFocus(m,{drillEdits:{1:{state:'parked'}}});assert.deepEqual(m.selected,[0,2]);assert.equal(m.drills[0].evidence,'personal');
});
