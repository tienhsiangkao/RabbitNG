import test from 'node:test';import assert from 'node:assert/strict';
import {focusCue} from '../src/focus-cue.js';import {urgentDrills} from '../src/user-drill-presets.js';
test('seven urgent reminders show brief cues without changing full notes',()=>{
 const before=JSON.stringify(urgentDrills);
 for(const d of urgentDrills){const v=focusCue(d);assert.ok(v.title&&v.cue);assert.ok(Array.from(v.cue).length<=90);assert.ok(Array.from(v.context).length<=40);assert.notEqual(v.cue,d.detail);}
 assert.equal(JSON.stringify(urgentDrills),before);
});
test('custom module edits remain visible and unknown reminders have bounded plain-text previews',()=>{
 const v=focusCue({...urgentDrills[0],action:'My edited action'});assert.equal(v.title,'My edited action');
 const custom=focusCue({action:'Test',position:'BB',street:'River',detail:'x'.repeat(500)});assert.ok(custom.cue.length<=90);assert.equal(custom.context,'BB · River');
});
