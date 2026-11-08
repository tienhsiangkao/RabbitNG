import path from 'node:path';
export class SessionFocusPanel{
 constructor({BrowserWindow,root,getState,onHide}){Object.assign(this,{BrowserWindow,root,getState,onHide});this.window=null;this.ready=false;this.context=null;this.destroying=false;this.lastState='';}
 accepts(sender){return !!this.window&&!this.window.isDestroyed()&&sender===this.window.webContents;}
 sync(context){
  if(this.destroying)return;
  this.context=context;
  if(!context?.show||!context.rect){try{this.window?.hide();}catch{}return;}
  if(!this.window||this.window.isDestroyed())this.create(context.rect);
  if(!this.ready)return;
  const win=this.window,current=win.getBounds();
  const zoom=context.zoom||1;
  if(this.zoom!==zoom){win.webContents.setZoomFactor?.(zoom);this.zoom=zoom;}
  if(['x','y','width','height'].some(k=>current[k]!==context.rect[k]))win.setBounds(context.rect,false);
  this.publish();if(!win.isVisible())win.showInactive();
 }
 publish(){
  if(!this.ready||!this.window||this.window.isDestroyed())return;
  const state=this.getState(),key=JSON.stringify(state);if(key===this.lastState)return;
  this.window.webContents.send('session-focus:state',state);this.lastState=key;
 }
 create(rect){
  this.ready=false;this.lastState='';this.zoom=null;
  const win=new this.BrowserWindow({...rect,title:'Poker Session Focus',frame:false,transparent:true,backgroundColor:'#00000000',
   resizable:false,alwaysOnTop:true,focusable:true,skipTaskbar:true,hasShadow:false,show:false,
   minimizable:false,maximizable:false,thickFrame:false,
   webPreferences:{preload:path.join(this.root,'src','session-focus-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  this.window=win;win.setAlwaysOnTop(true,'screen-saver');
  win.webContents.setWindowOpenHandler?.(()=>({action:'deny'}));
  win.webContents.on?.('will-navigate',event=>event.preventDefault());
  win.webContents.once('did-finish-load',()=>{if(this.window!==win||win.isDestroyed())return;this.ready=true;this.sync(this.context);});
  win.on('close',event=>{if(this.destroying)return;event.preventDefault();void Promise.resolve().then(()=>this.onHide()).catch(()=>this.reportFailure({enabled:false}));});
  win.on('closed',()=>{if(this.window===win){this.window=null;this.ready=false;}});
  win.loadFile(path.join(this.root,'src','session-focus.html')).catch(error=>console.error('[session focus] Could not load panel:',error.message));
 }
 status(){return {visible:!!this.window&&!this.window.isDestroyed()&&this.window.isVisible(),ready:this.ready,
  bounds:this.window&&!this.window.isDestroyed()?this.window.getBounds():null,spaceAvailable:!!this.context?.rect};}
 reportFailure(patch){try{this.window?.webContents.send('session-focus:failure',patch);}catch{}}
 destroy(){this.destroying=true;try{this.window?.destroy();}catch{}this.window=null;this.ready=false;}
}
