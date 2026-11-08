// Pure model of node-window-manager's Windows write/read rounding.
export function physicalToNativeBounds(rect,scale){
 return Object.fromEntries(['x','y','width','height'].map(key=>{
  const pixel=Math.round(rect[key]);let logical=pixel/scale;
  if(Math.floor(logical*scale)!==pixel)logical=(pixel+Math.max(1,Math.abs(pixel))*Number.EPSILON*4)/scale;
  if(Math.floor(logical*scale)!==pixel)throw new RangeError('Native bounds cannot represent the requested pixel');
  return [key,logical];
 }));
}
export function nativeReadbackBounds(rect,scale){
 return Object.fromEntries(['x','y','width','height'].map(key=>[key,Math.floor(Math.round(rect[key])/scale)*scale]));
}
