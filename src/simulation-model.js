import {physicalToNativeBounds} from './native-window-bounds.js';
export function createSimulationModel(){
 const work={x:0,y:0,width:3840,height:2112},moves=[],fixtures=[];
 let scale=1,ownWindows=()=>[];
 const monitor={id:1,isPrimary:()=>true,isValid:()=>true,getBounds:()=>({...work}),getWorkArea:()=>({...work}),getScaleFactor:()=>scale};
 const make=(id,title,minimum,maximum=minimum)=>{
  let physical={x:50+id*35,y:50+(id%3)*40,width:800,height:600};
  const win={id,processId:900001,path:'C:/PokerRNG-Simulation/GGnet.exe',title,visible:true,alive:true,cloaked:false,minimized:false,
   minimum,maximum,getTitle(){return this.title;},getProcessName:()=> 'GGnet.exe',getClassName:()=> 'ApolloRuntimeContentWindow',
   getBounds:()=>Object.fromEntries(Object.entries(physical).map(([k,v])=>[k,Math.floor(v/scale)])),
   physicalBounds:()=>({...physical}),setPhysicalBounds:r=>{physical={...r};},getMonitor:()=>monitor,
   setBounds(rect){physical=Object.fromEntries(Object.entries(rect).map(([k,v])=>[k,Math.floor(v*scale)]));moves.push({id,rect:{...physical}});},
   isVisible(){return this.visible;},isMinimized(){return this.minimized;},isWindow(){return this.alive;},bringToTop(){} };
  fixtures.push(win);return win;
 };
 const tables=Array.from({length:6},(_,i)=>make(i+1,i<4?'Rush & Cash - $0.10 / $0.25':'Rush & Cash - $0.05 / $0.10',{width:560,height:415},{width:9999,height:9999}));
 make(101,'Bankroll Challenge Information',{width:424,height:600});
 make(102,'Simulation Player',{width:404,height:582});
 make(103,'HH  Rush & Cash $0.10 / $0.25',{width:898,height:700},{width:898,height:2160});
 const state=win=>({className:win.getClassName?.()||'Chrome_WidgetWin_1',cloaked:!!win.cloaked,shellSurface:false});
 const visible=win=>win.alive!==false&&win.isVisible()&&!win.isMinimized?.()&&!win.cloaked;
 const workspaceAdapter={visible,minimized:win=>win.minimized===true,isDragging:()=>false,
  layoutState:win=>({nativeVisible:win.visible,minimized:win.minimized,cloaked:win.cloaked}),
  inspect:win=>({...state(win),dpi:96*scale,min:win.minimum||{},max:win.maximum||{}}),
  bounds:win=>Object.fromEntries(Object.entries(win.getBounds()).map(([k,v])=>[k,v*scale])),
  isAlive:r=>fixtures.some(w=>w.id===r.id&&w.processId===r.pid&&w.alive),
  place:(win,rect)=>{if(!fixtures.includes(win))throw Error('Simulation refuses a foreign window');win.setBounds(physicalToNativeBounds(rect,scale));return true;}};
 const dip=rect=>Object.fromEntries(['x','y','width','height'].map(k=>[k,Math.round(rect[k]/scale)]));
 const display=()=>({id:1,bounds:dip(work),workArea:dip(work),scaleFactor:scale});
 const screen={getAllDisplays:()=>[display()],getPrimaryDisplay:display,getDisplayMatching:display,getDisplayNearestPoint:display,
  screenToDipRect:(_,rect)=>dip(rect),dipToScreenRect:(_,rect)=>Object.fromEntries(Object.entries(rect).map(([k,v])=>[k,Math.round(v*scale)]))};
 return {tables,fixtures,moves,workspaceAdapter,readDisplayState:state,screen,
  windowManager:{getWindows:()=>[...ownWindows(),...fixtures.filter(w=>w.alive)],getMonitors:()=>[monitor],getActiveWindow:()=>null},
  addTable:(id=7)=>make(id,'Rush & Cash - $2 / $5',{width:2000,height:1000},{width:9999,height:9999}),
  registerOwnWindows:provider=>{ownWindows=provider;},setScale:value=>{scale=value;},get scale(){return scale;}};
}
