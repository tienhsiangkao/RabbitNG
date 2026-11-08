export const APPEARANCE_DEFAULTS = Object.freeze({frameThickness:2,frameOpacity:.85,rngScale:1,rngGap:.012});
const ranges={frameThickness:[1,6],frameOpacity:[.2,1],rngScale:[.6,1.6],rngGap:[.005,.05]};
function values(raw={}) {
  return Object.fromEntries(Object.entries(APPEARANCE_DEFAULTS).map(([key,fallback])=> {
    const value=typeof raw?.[key]==='number' && Number.isFinite(raw[key]) ? raw[key] : fallback;
    return [key,Math.max(ranges[key][0],Math.min(ranges[key][1],value))];
  }));
}
export function normalizeAppearance(raw={}) {
  return {...values(raw),presets:{four:values(raw?.presets?.four),six:values(raw?.presets?.six)}};
}

export function applyThinBorderDefaults(raw={}) {
  if(raw.thinBorderDefaultsVersion>=1)return raw;
  const source=raw.appearance||{},appearance=normalizeAppearance(source);
  const half=value=>typeof value==='number'&&Number.isFinite(value)?Math.max(1,Math.min(6,value/2)):APPEARANCE_DEFAULTS.frameThickness;
  appearance.frameThickness=half(source.frameThickness);
  for(const key of ['four','six'])appearance.presets[key].frameThickness=half(source.presets?.[key]?.frameThickness);
  return {...raw,thinBorderDefaultsVersion:1,appearance};
}
export function patchAppearance(raw,patch={}) {
  const before=normalizeAppearance(raw);
  let next=patch.reset===true ? {...APPEARANCE_DEFAULTS,presets:before.presets} : before;
  if(['four','six'].includes(patch.loadPreset)) next={...next,...before.presets[patch.loadPreset]};
  for(const key of Object.keys(ranges)) if(key in patch) next[key]=patch[key];
  next=normalizeAppearance(next);
  if(['four','six'].includes(patch.savePreset)) next.presets[patch.savePreset]=values(next);
  return next;
}
