import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAppearance, patchAppearance,applyThinBorderDefaults } from '../src/appearance-settings.js';
import { normalizeComfort, SessionComfort, sharedClockRect } from '../src/session-comfort.js';
import { rngOverlaySize, heroHandOverlayRect } from '../src/overlay-sizing.js';
import { tableFrameLayout } from '../src/table-frame-layout.js';

test('appearance defaults preserve existing design and clamp saved values', () => {
  const a = normalizeAppearance();
  assert.equal(a.frameThickness,2); assert.equal(a.frameOpacity,.85); assert.equal(a.rngScale,1); assert.equal(a.rngGap,.012);
  assert.equal(normalizeAppearance({frameThickness:99,frameOpacity:-1,rngScale:0,rngGap:Infinity}).frameThickness,6);
  assert.equal(normalizeAppearance({frameOpacity:-1}).frameOpacity,.2);
  assert.equal(normalizeAppearance({rngGap:Infinity}).rngGap,.012);
});

test('thinner border upgrade halves current and saved preset strokes exactly once',()=>{
  const raw={workspace:{enabled:false},appearance:{frameThickness:4,frameOpacity:.6,rngScale:1.2,presets:{four:{frameThickness:4},six:{frameThickness:6}}}};
  const next=applyThinBorderDefaults(raw);
  assert.equal(next.appearance.frameThickness,2);assert.equal(next.appearance.presets.four.frameThickness,2);assert.equal(next.appearance.presets.six.frameThickness,3);
  assert.equal(next.appearance.frameOpacity,.6);assert.equal(next.appearance.rngScale,1.2);assert.deepEqual(next.workspace,raw.workspace);
  assert.deepEqual(applyThinBorderDefaults(next),next);
  assert.equal(applyThinBorderDefaults({}).appearance.frameThickness,2);
});
test('four and six table appearance presets save independent snapshots and reset preserves them', () => {
  let a = patchAppearance(null,{rngScale:1.3,savePreset:'four'});
  a = patchAppearance(a,{rngScale:.8,savePreset:'six'});
  a = patchAppearance(a,{loadPreset:'four'}); assert.equal(a.rngScale,1.3);
  a = patchAppearance(a,{reset:true}); assert.equal(a.rngScale,1);
  a = patchAppearance(a,{loadPreset:'six'}); assert.equal(a.rngScale,.8);
});
test('appearance changes preserve hand-relative spacing at multiple table sizes', () => {
  for(const width of [800,1490,2980]) {
    const t={x:100,y:40,width,height:width*.7};
    const original=rngOverlaySize({},t), adjusted=rngOverlaySize({},t,{rngScale:1.3});
    assert.ok(adjusted.width>original.width);
    const r=heroHandOverlayRect({},t,{rngScale:1.3,rngGap:.025});
    assert.ok(Math.abs(r.x+r.width-(t.x+width*.405))<=1);
    assert.equal(tableFrameLayout(t).thickness,tableFrameLayout(t,[],{frameThickness:4}).thickness/2);
  }
});
test('session time pauses with no tables and breaks can be snoozed or completed', () => {
  const s=new SessionComfort(0); const cfg={breakEnabled:true,breakMinutes:15};
  s.setPlaying(true,0);
  s.tick(300000,false,cfg); assert.equal(s.status(cfg).seconds,0);
  s.tick(1200000,true,cfg); assert.equal(s.status(cfg).breakDue,true);
  s.snooze(); assert.equal(s.status(cfg).breakDue,false);
  s.tick(1800000,true,cfg); assert.equal(s.status(cfg).breakDue,true);
  s.completeBreak(cfg); assert.equal(s.status(cfg).breakDue,false);
  s.tick(2700000,true,cfg); assert.equal(s.status(cfg).breakDue,true);
  s.reset(2700000); assert.equal(s.status(cfg).seconds,0);
});
test('visible sitting-out time is excluded; start and pause settle exact boundaries',()=>{
  const s=new SessionComfort(0);
  s.tick(5000,true);assert.equal(s.status().seconds,0);assert.equal(s.status().playing,false);assert.equal(s.status().paused,true);
  s.setPlaying(true,6000);s.tick(10000,true);assert.equal(s.status().seconds,4);
  s.setPlaying(false,11000);s.tick(20000,true);assert.equal(s.status().seconds,5);
  s.setPlaying(true,21000);s.tick(24000,true);assert.equal(s.status().seconds,8);
  s.tick(25000,false);s.tick(30000,false);assert.equal(s.status().seconds,8);
  s.reset(30000);assert.equal(s.status().seconds,0);assert.equal(s.status().playing,true);
});
test('shared clock position stays inside a display including negative coordinates', () => {
  const work={x:-1920,y:40,width:1920,height:1040};
  assert.deepEqual(sharedClockRect(work,{x:9000,y:-500}),{x:-324,y:40,width:324,height:148});
  assert.equal(normalizeComfort({breakMinutes:0,clockMode:'bad'}).breakMinutes,15);
  assert.equal(normalizeComfort().clockMode,'shared');
});
