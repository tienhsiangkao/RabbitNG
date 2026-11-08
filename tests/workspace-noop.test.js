import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceManager} from '../src/workspace-manager.js';
import {physicalToNativeBounds,nativeReadbackBounds} from '../src/native-window-bounds.js';
test('rediscovered utility at its assigned coordinates causes no native write',()=>{
 const target={x:100,y:100,width:424,height:600},win={id:1,processId:9,path:'C:/GGnet.exe',title:'Bankroll Challenge Information'};
 let writes=0;const manager=new WorkspaceManager({adapter:{visible:()=>true,inspect:()=>({min:{width:424,height:600}}),bounds:()=>target,place:()=>{writes++;}}});
 const plan={scaleFactor:1,slots:{challenge:target}};
 manager.sync([win],plan);manager.sync([],plan);manager.sync([win],plan);
 assert.equal(writes,0);
});
test('native conversion survives both floor operations at all supported DPI values and negative origins',()=>{
 for(const scale of [1,1.25,1.5,1.75,2,2.25,2.5,3])for(const x of [-3840,-1854,-1,0,1,447,1854,3840]){
  const rect={x,y:x,width:982,height:702},logical=physicalToNativeBounds(rect,scale);
  const actual=Object.fromEntries(Object.entries(logical).map(([k,v])=>[k,Math.floor(v*scale)]));
  assert.deepEqual(actual,rect);
  const read=Object.fromEntries(Object.entries(actual).map(([k,v])=>[k,Math.floor(v/scale)*scale]));
  assert.deepEqual(read,nativeReadbackBounds(rect,scale));
 }
});
