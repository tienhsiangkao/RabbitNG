import { normalizeTableLayoutSettings, getActiveLayoutProfile } from './table-layout.js';

// One-time upgrade of the formerly manual defaults. Later user opt-outs stay
// intact; existing custom profiles remain available rather than being replaced.
export function applyAutomaticDefaults(raw={}) {
  if(Number(raw.comfortDefaultsVersion)>=4)return raw;
  let upgraded=raw;
  if(!(Number(raw.comfortDefaultsVersion)>=2)) {
    const layout=normalizeTableLayoutSettings(raw.tableLayout);
    if(Array.isArray(raw.tableLayout?.profiles)&&raw.tableLayout.profiles.length) {
      const previous=getActiveLayoutProfile(layout);
      let id='automatic',suffix=2;
      while(layout.profiles.some(p=>p.id===id))id=`automatic-${suffix++}`;
      layout.profiles.push({...previous,id,name:'Automatic',monitorId:'primary',rows:0,columns:0});
      layout.activeProfileId=id;
    }
    upgraded={...raw,
      tableLayout:{...layout,enabled:true,autoArrange:true,arrangeOnStartup:true},
      comfort:{...raw.comfort,clockMode:'shared'},
      overlays:{...raw.overlays,clockEnabled:true}};
  }
  // Older automatic profiles inherited a native monitor ID from the former
  // manual grid. Follow Windows' main display instead of that stale selection.
  // This upgrade runs once; manual profiles and later monitor choices survive.
  const layout=normalizeTableLayoutSettings(upgraded.tableLayout);
  return {...upgraded,comfortDefaultsVersion:4,workspace:{enabled:true,...upgraded.workspace},tableLayout:{...layout,
    profiles:layout.profiles.map(profile=>layout.autoArrange&&profile.id===layout.activeProfileId
      ? {...profile,monitorId:'primary',gap:0,margin:0} : profile)}};
}
