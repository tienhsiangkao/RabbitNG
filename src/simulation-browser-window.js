// Real local renderers, but no own window is ever shown, focused, or raised.
export function createHiddenSimulationBrowserWindow(RealBrowserWindow,onCreate){
 function BrowserWindow(options){
  let logicalVisible=false,bounds={x:options.x??0,y:options.y??0,width:options.width??800,height:options.height??600};
  const win=new RealBrowserWindow({...options,x:0,y:0,show:false,transparent:false,alwaysOnTop:false,focusable:false,skipTaskbar:true,
   webPreferences:{...options.webPreferences,offscreen:true,backgroundThrottling:false}});
  const actualVisible=win.isVisible.bind(win),actualSetBounds=win.setBounds.bind(win);
  win.show=win.showInactive=()=>{logicalVisible=true;};win.hide=()=>{logicalVisible=false;};
  win.isVisible=()=>logicalVisible;
  win.focus=win.moveTop=win.moveAbove=win.setAlwaysOnTop=()=>{};
  win.getBounds=()=>({...bounds});
  win.setBounds=next=>{bounds={...bounds,...next};actualSetBounds({x:0,y:0,width:bounds.width,height:bounds.height});};
  win.setPosition=(x,y)=>{bounds={...bounds,x,y};};win.getPosition=()=>[bounds.x,bounds.y];
  win.setSize=(width,height)=>win.setBounds({width,height});win.getSize=()=>[bounds.width,bounds.height];
  win.webContents.setFrameRate?.(5);
  onCreate(win,{actualVisible});return win;
 }
 for(const name of ['getAllWindows','fromWebContents','fromId'])if(RealBrowserWindow[name])BrowserWindow[name]=RealBrowserWindow[name].bind(RealBrowserWindow);
 BrowserWindow.getFocusedWindow=()=>null;
 return BrowserWindow;
}
