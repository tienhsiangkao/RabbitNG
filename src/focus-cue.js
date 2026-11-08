import {urgentDrills} from './user-drill-presets.js';
const brief=(text,n)=>{const chars=Array.from(String(text||'').replace(/\s+/g,' ').trim());return chars.length>n?chars.slice(0,n-1).join('')+'…':chars.join('');};
const cues=[
 ['BB · Flop/Turn','Call pairs; raise less','50–75%: call pairs. BTN 33%: XR ~15%.'],
 ['BTN vs blinds · Preflop','Defend suited + 66+','Offsuit calls: AQo+ only.'],
 ['BTN / SB · Turn','Use selected bets','BTN: 50% or 100%+. SB: 2P+ only. No extra air.'],
 ['BB · Turn after X/X','Bet pairs','vs BTN: pairs/draws 75%. vs SB: pairs 50–75%.'],
 ['River vs bet','Call by sizing','≤50%: pairs. 75%: TP+. Overbet: fold weak.'],
 ['Preflop · 4-bets','Use position-specific ranges','SB: more suited. BTN: value only. CO: replace offsuit junk.'],
 ['BB · River after X/X → X/X','Separate bluff / thin value','Bluff 75%. Thin value 33–50%.']
];
export function focusCue(d={}){
 if(d.cue)return {context:brief([d.position,d.street].filter(Boolean).join(' · '),40),title:brief(d.action||'Practice reminder',60),cue:brief(d.cue,90)};
 const i=urgentDrills.findIndex(p=>p.detail===d.detail);
 if(i>=0){const [context,title,cue]=cues[i],p=urgentDrills[i];return {context:d.position===p.position&&d.street===p.street?context:brief([d.position,d.street].filter(Boolean).join(' · '),40),title:brief(d.action===p.action?title:d.action||title,60),cue};}
 return {context:brief([d.position,d.street].filter(Boolean).join(' · '),40),title:brief(d.action||'Practice reminder',60),cue:brief(String(d.detail||'').split('\n')[0],90)};
}
