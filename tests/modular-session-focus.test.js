import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeSessionFocus,patchSessionFocus} from '../src/session-focus-model.js';
test('seven modular drills retain full qualifications and per-field edits merge',()=>{
 const drills=Array.from({length:7},(_,i)=>({position:'BB vs BTN',pot:'Single-raised',street:'River',action:'Call more',detail:'Condition '+i+' '+('x'.repeat(450))}));
 let m=normalizeSessionFocus({drills,active:6});assert.equal(m.lines.length,7);assert.equal(m.drills.length,7);assert.equal(m.active,6);assert.equal(m.drills[0].detail,drills[0].detail);
 m=patchSessionFocus(m,{drillEdits:{0:{action:'Raise less'}}});m=patchSessionFocus(m,{drillEdits:{0:{position:'BB vs SB'}}});
 assert.equal(m.drills[0].action,'Raise less');assert.equal(m.drills[0].detail,drills[0].detail);
 m=patchSessionFocus(m,{lineEdits:{0:'Edited in Settings'}});assert.equal(m.drills[0].detail,'Edited in Settings');assert.equal(m.drills[0].action,'Raise less');
});
test('legacy notes survive opting into modules; unknown fields and controls are bounded',()=>{
 const old=normalizeSessionFocus({lines:['Keep this note']});const next=patchSessionFocus(old,{drillEdits:{0:{action:'Call more',junk:'ignored'}}});
 assert.equal(next.drills[0].detail,'Keep this note');assert.equal(next.drills[0].junk,undefined);
 assert.equal(normalizeSessionFocus({drills:[{detail:'x'.repeat(4000)}]}).drills[0].detail.length,2400);
});

test('urgent preset keeps all seven drills, full range qualifications, and previous reminders',async()=>{
 const {urgentDrills,mergeUrgentDrills}=await import('../src/user-drill-presets.js');
 const merged=mergeUrgentDrills({lines:['Prior custom reminder']});assert.equal(urgentDrills.length,7);assert.equal(merged.length,8);
 const normalized=normalizeSessionFocus({drills:merged});assert.equal(normalized.drills[7].detail,'Prior custom reminder');
 for(const [i,d]of urgentDrills.entries())assert.equal(normalized.drills[i].detail,d.detail);
 assert.match(normalized.drills[5].detail,/KJo\/KTo.*ATs\/A5s\/QJs\/TT–77/);
 assert.match(normalized.drills[0].detail,/24%.*15%/);assert.match(normalized.drills[4].detail,/board pairs/);
 assert.equal(mergeUrgentDrills(normalized).length,8,'repeat seeding does not duplicate urgent reminders');
});
