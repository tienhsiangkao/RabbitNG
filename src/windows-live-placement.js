import koffi from 'koffi';
import path from 'node:path';
import {makeLivePhysicalPlacer} from './live-physical-placement.js';
export function createWindowsLivePhysicalPlacer(){
 const system=path.join(process.env.SystemRoot||'C:\\Windows','System32');
 const user=koffi.load(path.join(system,'user32.dll')),dwm=koffi.load(path.join(system,'dwmapi.dll'));
 const exists=user.func('int __stdcall IsWindow(uintptr_t hwnd)'),owner=user.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hwnd,_Out_ uint32_t *pid)');
 const visible=user.func('int __stdcall IsWindowVisible(uintptr_t hwnd)'),iconic=user.func('int __stdcall IsIconic(uintptr_t hwnd)');
 const attribute=dwm.func('int32_t __stdcall DwmGetWindowAttribute(uintptr_t hwnd,uint32_t attribute,_Out_ uint32_t *value,uint32_t size)');
 // MoveWindow changes geometry without changing focus or z-order.
 const move=user.func('int __stdcall MoveWindow(uintptr_t hwnd,int x,int y,int width,int height,int repaint)');
 return makeLivePhysicalPlacer({exists:id=>!!exists(id),pid:id=>{const pid=[0];return owner(id,pid)&&pid[0]>0?pid[0]:null;},
  visible:id=>!!visible(id),iconic:id=>!!iconic(id),cloaked:id=>{const value=[0];return attribute(id,14,value,4)>=0?value[0]!==0:null;},move});
}
