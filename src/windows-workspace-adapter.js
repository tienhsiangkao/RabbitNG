import koffi from 'koffi';
import path from 'node:path';
import {createWindowDisplayStateReader} from './windows-display-state.js';
import {physicalToNativeBounds} from './native-window-bounds.js';

export function createWindowsWorkspaceAdapter(){
  const user=koffi.load(path.join(process.env.SystemRoot||'C:\\Windows','System32','user32.dll'));
  const dpi=user.func('uint32_t __stdcall GetDpiForWindow(uintptr_t hwnd)');
  const send=user.func('intptr_t __stdcall SendMessageTimeoutW(uintptr_t hwnd,uint32_t message,uintptr_t wparam,void *lparam,uint32_t flags,uint32_t timeout,_Out_ uintptr_t *result)');
  const iconic=user.func('int __stdcall IsIconic(uintptr_t hwnd)');
  const exists=user.func('int __stdcall IsWindow(uintptr_t hwnd)');
  const owner=user.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hwnd,_Out_ uint32_t *pid)');
  const keyState=user.func('int16_t __stdcall GetAsyncKeyState(int key)');
  const state=createWindowDisplayStateReader(),cache=new Map();
  return {
    isAlive:identity=>{
      if(!exists(identity.id))return false;
      const pid=[0];if(!owner(identity.id,pid)||!pid[0])return true;
      return pid[0]===identity.pid;
    },
    isDragging:()=>!!((keyState(1)|keyState(2))&0x8000),
    minimized:win=>!!iconic(win.id),
    layoutState:win=>{
      const pid=[0];
      if(!exists(win.id)||!owner(win.id,pid)||pid[0]!==win.processId)return {};
      const display=state(win);
      return {nativeVisible:win.isVisible(),minimized:!!iconic(win.id),cloaked:display.cloakedKnown===true?display.cloaked:null};
    },
    bounds:win=>{
      const bounds=win.getBounds(),factor=win.getMonitor?.()?.getScaleFactor?.()||1;
      return Object.fromEntries(Object.entries(bounds).map(([key,value])=>[key,value*factor]));
    },
    visible:win=>{const s=state(win);return win.isVisible()&&!iconic(win.id)&&!s.cloaked;},
    inspect:win=>{
      const windowDpi=dpi(win.id)||96,key=JSON.stringify([win.processId,win.path,win.getTitle?.(),windowDpi]);
      if(cache.get(win.id)?.key===key)return cache.get(win.id).info;
      const buffer=Buffer.alloc(40),result=[0];
      if(!send(win.id,0x24,0,buffer,3,75,result))return {};
      const factor=windowDpi/96,info={...state(win),dpi:windowDpi,
        min:{width:buffer.readInt32LE(24)/factor,height:buffer.readInt32LE(28)/factor},
        max:{width:buffer.readInt32LE(32)/factor,height:buffer.readInt32LE(36)/factor}};
      cache.set(win.id,{key,info});if(cache.size>256)cache.delete(cache.keys().next().value);
      return info;
    },
    place:(win,rect,info,targetScale=1)=>{
      for(const key of ['width','height']){
        if(info.min?.[key]>0&&rect[key]+2<info.min[key]*targetScale)return false;
        if(info.max?.[key]>0&&rect[key]-2>info.max[key]*targetScale)return false;
      }
      // The planner uses native physical coordinates; node-window-manager
      // expects bounds divided by the window's CURRENT monitor scale.
      const factor=win.getMonitor?.()?.getScaleFactor?.()||1;
      win.setBounds(physicalToNativeBounds(rect,factor));
      const actual=win.getBounds(),afterScale=win.getMonitor?.()?.getScaleFactor?.()||1;
      return Object.keys(rect).every(key=>Math.abs(actual[key]*afterScale-rect[key])<=Math.max(2,afterScale));
    }
  };
}
