// Pure boundary; the native implementation supplies ordinary window APIs.
export function makeLivePhysicalPlacer(api){
 return (identity,rect)=>{
  if(!['x','y','width','height'].every(k=>Number.isInteger(rect[k])&&rect[k]>=-2147483648&&rect[k]<=2147483647)||rect.width<=0||rect.height<=0)throw Error('Invalid physical rectangle');
  if(!api.exists(identity.id)||api.pid(identity.id)!==identity.pid||!api.visible(identity.id)||api.iconic(identity.id)||api.cloaked(identity.id)!==false)throw Error('Native owner or visibility is uncertain');
  if(!api.move(identity.id,rect.x,rect.y,rect.width,rect.height,1))throw Error('Windows refused the approved physical placement');
 };
}
