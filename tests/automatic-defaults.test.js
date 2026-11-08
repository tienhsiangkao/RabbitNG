import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAutomaticDefaults } from '../src/automatic-defaults.js';
import { normalizeComfort } from '../src/session-comfort.js';
import { normalizeTableLayoutSettings, getActiveLayoutProfile, calculateTileRects } from '../src/table-layout.js';

test('new installs arrange automatically and show a shared clock by default',()=>{
  const settings=applyAutomaticDefaults({});
  assert.equal(settings.tableLayout.enabled,true);
  assert.equal(settings.tableLayout.autoArrange,true);
  assert.equal(settings.tableLayout.arrangeOnStartup,true);
  assert.equal(settings.comfort.clockMode,'shared');
  assert.equal(settings.overlays.clockEnabled,true);
  assert.equal(normalizeComfort().clockMode,'shared');
  const profile=getActiveLayoutProfile(normalizeTableLayoutSettings());
  assert.equal(profile.rows,0);assert.equal(profile.columns,0);
  const six=calculateTileRects({x:0,y:0,width:3840,height:2160},6,profile,{columnFirst:true});
  assert.equal(new Set(six.map(r=>r.x)).size,3);assert.equal(new Set(six.map(r=>r.y)).size,2);
});
test('existing installation keeps its custom profile but starts automatic layout on the main display',()=>{
  const old={enabled:true,autoArrange:true,arrangeOnStartup:false,activeProfileId:'custom',profiles:[{id:'custom',name:'My grid',monitorId:'monitor:42',rows:3,columns:3,gap:8,margin:4}]};
  const migrated=applyAutomaticDefaults({tableLayout:old,comfort:{clockMode:'table',breakMinutes:45},overlays:{clockEnabled:false}});
  assert.equal(migrated.tableLayout.enabled,true);assert.equal(migrated.tableLayout.arrangeOnStartup,true);
  assert.deepEqual(migrated.tableLayout.profiles.find(p=>p.id==='custom'),old.profiles[0]);
  const active=getActiveLayoutProfile(migrated.tableLayout);
  assert.equal(active.monitorId,'primary');assert.equal(active.rows,0);assert.equal(active.columns,0);
  assert.equal(migrated.comfort.clockMode,'shared');assert.equal(migrated.comfort.breakMinutes,45);
  const optedOut={...migrated,comfort:{...migrated.comfort,clockMode:'table'},tableLayout:{...migrated.tableLayout,enabled:false}};
  assert.deepEqual(applyAutomaticDefaults(optedOut),optedOut);
});

test('version-two secondary-monitor layout moves to primary once without resetting preferences',()=>{
  const raw={comfortDefaultsVersion:2,tableLayout:{enabled:true,autoArrange:true,arrangeOnStartup:true,activeProfileId:'automatic',profiles:[
    {id:'custom',name:'Old grid',monitorId:'monitor:42',rows:3,columns:3,gap:8,margin:0},
    {id:'automatic',name:'Automatic',monitorId:'monitor:42',rows:0,columns:0,gap:12,margin:6}
  ]},comfort:{clockMode:'table',breakMinutes:45},overlays:{clockEnabled:false},appearance:{rngScale:1.2}};
  const migrated=applyAutomaticDefaults(raw);
  assert.equal(getActiveLayoutProfile(migrated.tableLayout).monitorId,'primary');
  assert.equal(getActiveLayoutProfile(migrated.tableLayout).gap,0);
  assert.equal(getActiveLayoutProfile(migrated.tableLayout).margin,0);
  assert.deepEqual(migrated.tableLayout.profiles[0],raw.tableLayout.profiles[0]);
  assert.deepEqual(migrated.comfort,raw.comfort);
  assert.deepEqual(migrated.overlays,raw.overlays);
  assert.deepEqual(migrated.appearance,raw.appearance);
  assert.equal(raw.tableLayout.profiles[1].monitorId,'monitor:42','migration must not mutate its input');
  const laterChoice={...migrated,tableLayout:{...migrated.tableLayout,enabled:false}};
  assert.deepEqual(applyAutomaticDefaults(laterChoice),laterChoice);
});

test('workspace upgrade removes active automatic gaps once without changing saved custom profiles',()=>{
  const old={comfortDefaultsVersion:3,tableLayout:{enabled:true,autoArrange:true,activeProfileId:'automatic',profiles:[{id:'custom',monitorId:'monitor:42',rows:3,columns:3,gap:18,margin:4},{id:'automatic',monitorId:'primary',rows:0,columns:0,gap:8,margin:8}]}};
  const next=applyAutomaticDefaults(old);
  assert.equal(next.workspace.enabled,true);
  assert.equal(getActiveLayoutProfile(next.tableLayout).gap,0);assert.equal(getActiveLayoutProfile(next.tableLayout).margin,0);
  assert.equal(next.tableLayout.profiles[0].gap,18);
  const optedOut={...next,workspace:{enabled:false}};assert.deepEqual(applyAutomaticDefaults(optedOut),optedOut);
});
