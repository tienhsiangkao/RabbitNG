import koffi from 'koffi';
import path from 'node:path';
import { createWindowDisplayStateReader } from './windows-display-state.js';

const PROP='PokerRNG.FocusWindow.v1';
const SYSTEM_CLASSES=new Set(['Progman','WorkerW','Shell_TrayWnd','Shell_SecondaryTrayWnd','XamlExplorerHostIslandWindow','Windows.UI.Core.CoreWindow','#32770']);
export function createWindowsFocusAdapter(windowManager) {
  const user=koffi.load(path.join(process.env.SystemRoot||'C:\\Windows','System32','user32.dll'));
  const valid=user.func('int __stdcall IsWindow(uintptr_t hwnd)');
  const visible=user.func('int __stdcall IsWindowVisible(uintptr_t hwnd)');
  const iconic=user.func('int __stdcall IsIconic(uintptr_t hwnd)');
  const style=user.func('intptr_t __stdcall GetWindowLongPtrW(uintptr_t hwnd,int index)');
  const owner=user.func('uintptr_t __stdcall GetWindow(uintptr_t hwnd,uint32_t command)');
  const placement=user.func('int __stdcall GetWindowPlacement(uintptr_t hwnd,void *value)');
  const setPlacement=user.func('int __stdcall SetWindowPlacement(uintptr_t hwnd,const void *value)');
  const show=user.func('int __stdcall ShowWindow(uintptr_t hwnd,int command)');
  const setProp=user.func('int __stdcall SetPropW(uintptr_t hwnd,const char16_t *name,uintptr_t value)');
  const getProp=user.func('uintptr_t __stdcall GetPropW(uintptr_t hwnd,const char16_t *name)');
  const removeProp=user.func('uintptr_t __stdcall RemovePropW(uintptr_t hwnd,const char16_t *name)');
  const ping=user.func('intptr_t __stdcall SendMessageTimeoutW(uintptr_t hwnd,uint32_t message,uintptr_t wparam,intptr_t lparam,uint32_t flags,uint32_t timeout,_Out_ uintptr_t *result)');
  const displayState=createWindowDisplayStateReader();
  const responsive=win=>!!ping(win.id,0,0,0,3,100,[0]);
  function readPlacement(win) {
    for(const size of [44,60]) {
      const buffer=Buffer.alloc(size);buffer.writeUInt32LE(size);
      if(placement(win.id,buffer))return buffer.toString('base64');
    }
    return null;
  }
  return {
    list:()=>windowManager.getWindows(),
    inspect:win=>{
      if(!valid(win.id))return null;
      const state=displayState(win),normal=readPlacement(win);
      const bits=Number(style(win.id,-16)),extended=Number(style(win.id,-20)),parent=Number(owner(win.id,4));
      return {id:win.id,pid:win.processId,path:String(win.path||'').toLowerCase(),owner:parent,
        visible:!!visible(win.id),minimized:!!iconic(win.id),placement:normal,
        protectOwner:!!visible(win.id)&&!iconic(win.id)&&!!parent&&(state.className==='#32770'||(!!(bits&0x80000000)&&!(extended&0x80))),
        eligible:!!normal&&!state.cloaked&&!state.shellSurface&&!SYSTEM_CLASSES.has(state.className)&&
          !parent&&!(bits&0x48000000)&&!(extended&0x80)&&!!(bits&0x20000)&&!!win.getTitle?.().trim()};
    },
    tag:(win,cookie)=>!!setProp(win.id,PROP,cookie),
    hasTag:(win,cookie)=>Number(getProp(win.id,PROP))===cookie,
    untag:win=>{removeProp(win.id,PROP);},
    minimize:win=>{if(!responsive(win))return false;show(win.id,6);return !!iconic(win.id);},
    restore:(win,saved)=>{
      if(typeof saved!=='string'||!responsive(win))return false;
      const buffer=Buffer.from(saved,'base64');
      if(![44,60].includes(buffer.length)||buffer.readUInt32LE(0)!==buffer.length||![1,3].includes(buffer.readUInt32LE(8)))return false;
      return !!setPlacement(win.id,buffer);
    }
  };
}
