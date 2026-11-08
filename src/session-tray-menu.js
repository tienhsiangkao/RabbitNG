import {formatSession} from './session-comfort.js';

// Every entry dispatches to the same session actions as the clock and Settings.
export function buildSessionTrayItems(status,{setPlaying,breakAction,reset}) {
 const resting=status.breakActive||status.breakReady;
 const phase=status.breakActive?`Break remaining: ${formatSession(status.breakRemainingSeconds).slice(3)}`:
  status.breakReady?'Break finished — resume when ready':status.breakDue?'Break due':null;
 return [
  {label:`Playing time: ${status.session}${status.paused||!status.playing?' · Paused':''}`,enabled:false},
  ...(phase?[{label:phase,enabled:false}]:[]),
  {label:status.playing?'Pause playing':resting?'Resume playing':'Start playing',click:()=>setPlaying(!status.playing)},
  {label:'Start 10 min break',enabled:!resting,click:()=>breakAction('start-break')},
  {label:'Snooze 10 playing min',enabled:!!status.breakDue&&!resting,click:()=>breakAction('snooze')},
  {label:'Reset session timer',click:reset}
 ];
}
