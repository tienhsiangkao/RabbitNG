import fs from 'node:fs';
import {patchSessionFocus} from './session-focus-model.js';
export {normalizeSessionFocus,patchSessionFocus} from './session-focus-model.js';
export function saveSessionFocusPatch(settings,file,patch,io=fs){
 const next={...settings,sessionFocus:patchSessionFocus(settings.sessionFocus,patch)},temporary=file+'.session-focus.tmp';
 io.writeFileSync(temporary,JSON.stringify(next,null,2),'utf8');
 io.renameSync(temporary,file);
 return next;
}
