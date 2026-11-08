import koffi from 'koffi';
import path from 'node:path';

// IsWindowVisible only reports WS_VISIBLE. Start/Search and virtual-desktop
// windows can retain that bit while DWM suppresses their entire surface.
export function createWindowDisplayStateReader() {
  if (process.platform !== 'win32') return () => ({});
  const systemDir = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const dwm = koffi.load(path.join(systemDir, 'dwmapi.dll'));
  const user = koffi.load(path.join(systemDir, 'user32.dll'));
  const getAttribute = dwm.func('int32_t __stdcall DwmGetWindowAttribute(uintptr_t hwnd, uint32_t attribute, _Out_ uint32_t *value, uint32_t size)');
  const getClassName = user.func('int __stdcall GetClassNameW(uintptr_t hwnd, void *buffer, int capacity)');
  return (win) => {
    const cloaked = [0];
    const status = getAttribute(win.id, 14 /* DWMWA_CLOAKED */, cloaked, 4);
    const classBuffer = Buffer.alloc(512);
    const length = getClassName(win.id, classBuffer, 256);
    const className = classBuffer.toString('utf16le', 0, Math.max(0, length) * 2);
    const explorer = /[\\/]explorer[.]exe$/i.test(String(win.path || win.processPath || ''));
    // This is Explorer's transparent desktop composition container, not a
    // File Explorer window. It can cover the full desktop with no painted UI.
    const shellSurface = explorer && ['XamlExplorerHostIslandWindow', 'WorkerW', 'Progman'].includes(className);
    return { cloaked: status >= 0 && cloaked[0] !== 0, cloakedKnown:status>=0, className, shellSurface };
  };
}
