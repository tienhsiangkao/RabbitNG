// Offline candidate: physical rectangle arithmetic only. No application APIs.
const logicalUtilities={clock:{width:324,height:192},notes:{width:404,height:582},
 challenge:{width:424,height:600},replay:{width:898,height:700}};
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;

export function calculateSixShelf(work,options={}){
 if(!options||typeof options!=='object'||Array.isArray(options))return null;
 const {scaleFactor=1,tableMinimum={width:560,height:415}}=options;
 if(!work||!['x','y','width','height'].every(k=>Number.isSafeInteger(work[k]))||
   work.width<=0||work.height<=0||!Number.isSafeInteger(work.x+work.width)||
   !Number.isSafeInteger(work.y+work.height)||!positive(scaleFactor)||
   !tableMinimum||!positive(tableMinimum.width)||!positive(tableMinimum.height))return null;
 const px=value=>Math.ceil(value*scaleFactor),gap=px(8);
 const sizes=Object.fromEntries(Object.entries(logicalUtilities).map(([role,r])=>
  [role,{width:px(r.width),height:px(r.height)}]));
 const minimum={width:px(tableMinimum.width),height:px(tableMinimum.height)};
 if(![gap,...Object.values(sizes).flatMap(r=>[r.width,r.height]),minimum.width,minimum.height]
  .every(n=>Number.isSafeInteger(n)&&n>0))return null;
 const shelfWidth=Object.values(sizes).reduce((total,r)=>total+r.width,0)+gap*3;
 const shelfHeight=Math.max(...Object.values(sizes).map(r=>r.height));
 if(!Number.isSafeInteger(shelfWidth)||shelfWidth>work.width)return null;
 const cellWidth=Math.floor(work.width/3),cellHeight=Math.floor((work.height-shelfHeight-gap)/2);
 if(cellWidth<=0||cellHeight<=0)return null;
 let width,height;
 // Exact integer 7:5 arithmetic avoids rejecting a boundary fit such as
 // 645px high × 903px wide when binary decimal multiplication rounds down.
 if(BigInt(cellWidth)*5n>BigInt(cellHeight)*7n){
  height=cellHeight;width=Number(BigInt(height)*7n/5n);
 }else{
  width=cellWidth;height=Number(BigInt(width)*5n/7n);
 }
 if(width<minimum.width||height<minimum.height)return null;
 const tableX=work.x+Math.floor((work.width-width*3)/2);
 const tableRects=Array.from({length:6},(_,i)=>({x:tableX+Math.floor(i/2)*width,
  y:work.y+(i%2)*height,width,height}));
 const shelf={x:work.x+Math.floor((work.width-shelfWidth)/2),
  y:work.y+work.height-shelfHeight,width:shelfWidth,height:shelfHeight};
 let x=shelf.x;
 const slots=Object.fromEntries(Object.entries(sizes).map(([role,r])=>{
  const rect={x,y:shelf.y,...r};x+=r.width+gap;return [role,rect];
 }));
 return {mode:'full',layout:'six-centered-shelf',dock:'bottom',scaleFactor,workArea:{...work},
  grid:{rows:2,columns:3},tableArea:{x:tableX,y:work.y,width:width*3,height:height*2},
  tableRects,shelf,utilities:shelf,utilityRegions:[shelf],slots,sharedRoles:['replay'],
  message:'Six equal-size tables centered above a fixed clock, notes, challenge and shared replay shelf.'};
}
