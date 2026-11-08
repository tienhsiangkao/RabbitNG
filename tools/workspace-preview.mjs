// Generates fabricated diagrams from production geometry. No Electron,
// native windows, screen capture, account data, network or browser launch.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {calculatePokerWorkspace} from '../src/poker-workspace.js';
import {auxiliaryOverlayLayout} from '../src/overlay-sizing.js';

const output=path.resolve(process.argv[2]||path.join(os.tmpdir(),'PokerRNG-offline-preview'));
fs.mkdirSync(output,{recursive:true});
const work={x:0,y:0,width:3840,height:2112};
const plans=[4,6,9,12].map(count=>({key:String(count),label:`${count} tables`,count,
  ...calculatePokerWorkspace(work,count,{preferSixReviewLayout:true})}));
const box=(r,fill,stroke='#3b475c',radius=12)=>`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;
const text=(x,y,value,size=32,color='#dce4f0',anchor='start')=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" text-anchor="${anchor}" font-family="Segoe UI, sans-serif">${value}</text>`;
function render(plan){
  const parts=[`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3840 2112" role="img" aria-label="Offline ${plan.count}-table layout, fabricated content only">`,box(work,'#0b101a','#0b101a',0)];
  for(const [i,r]of plan.tableRects.entries()){
    const rank=Math.min(3,Math.floor(i/Math.ceil(plan.count/4))),level=[500,100,50,25][rank],color=['#c49aff','#f1bc59','#68b8f3','#7acc9d'][rank];
    parts.push(box(r,'#131c29',color,0));
    const cx=r.x+r.width/2,cy=r.y+r.height/2,s=r.width/1000;
    parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${r.width*.41}" ry="${r.height*.32}" fill="#173d34" stroke="#315d50" stroke-width="${6*s}"/>`);
    parts.push(text(r.x+24*s,r.y+24*s,`Table ${i+1}`,20*s,color));
    const plaque=auxiliaryOverlayLayout(r,false).stakes;
    parts.push(box({...plaque,height:plaque.panelHeight},'#111820',color,4),text(plaque.x+plaque.width/2,plaque.y+plaque.panelHeight*.8,`NL${level}`,plaque.fontSize,color,'middle'));
    parts.push(text(cx,cy,`${r.width} × ${r.height}`,37*s,'#a5c6bb','middle'));
    parts.push(text(cx,cy+48*s,'equal size · full table',25*s,'#88aa9f','middle'));
    const cards={x:cx-r.width*.067,y:r.y+r.height*.73,width:r.width*.134,height:r.height*.17};
    parts.push(box(cards,'#eef3f7','#eef3f7',6*s),text(cx,cards.y+cards.height*.6,'K  9',40*s,'#27384b','middle'));
    const rng={x:cards.x-96*s,y:cards.y+cards.height*.25,width:76*s,height:60*s};
    parts.push(box(rng,'#090f16','#3b5c51',7*s),text(rng.x+rng.width/2,rng.y+rng.height*.73,String(23+i*5),40*s,'#91d6b2','middle'));
  }
  const {clock,challenge,notes}=plan.slots;
  for(const r of Object.values(plan.slots))parts.push(box(r,'#1a2332'));
  parts.push(text(clock.x+clock.width/2,clock.y+57,'12:34',42,'#edf4ff','middle'),text(clock.x+clock.width/2,clock.y+99,'01:23:45',26,'#9eb0c8','middle'),text(clock.x+clock.width/2,clock.y+146,'Session · paused',23,'#b7d9c6','middle'));
  parts.push(text(challenge.x+28,challenge.y+55,'Bankroll challenge',30),text(challenge.x+28,challenge.y+101,'Full native window reserved',21,'#96a7bd'),text(challenge.x+28,challenge.y+203,'+$123.45',48,'#9bd2b4'),text(challenge.x+28,challenge.y+247,'Example amount only',22,'#96a7bd'));
  parts.push(text(notes.x+28,notes.y+55,'Player notes',30),text(notes.x+28,notes.y+105,'Dedicated notes region',22,'#96a7bd'));
  for(let i=0;i<6;i++)parts.push(`<rect x="${notes.x+28}" y="${notes.y+160+i*49}" width="${notes.width-70-(i%3)*48}" height="8" rx="4" fill="#34435a"/>`);
  for(const [role,replay]of Object.entries(plan.slots).filter(([role])=>role.startsWith('replay'))){
  parts.push(text(replay.x+32,replay.y+58,'Shared replayer region',34),text(replay.x+32,replay.y+105,'Short native format · replay windows stack here',23,'#96a7bd'));
  const replayTable={x:replay.x+48,y:replay.y+180,width:replay.width-96,height:Math.min(450,replay.height-245)};
  parts.push(box(replayTable,'#18362f','#315649',80));
  parts.push(text(replay.x+replay.width/2,replayTable.y+replayTable.height/2,'Review area',30,'#91aa9f','middle'));
  }
  parts.push('</svg>');return parts.join('\n');
}
for(const plan of plans)fs.writeFileSync(path.join(output,`layout-${plan.key}.svg`),render(plan));
fs.writeFileSync(path.join(output,'layouts.json'),JSON.stringify({fabricated:true,work,plans},null,2));
const coverage=p=>(p.tableRects.reduce((sum,r)=>sum+r.width*r.height,0)/(work.width*work.height)*100).toFixed(1);
const occupied=p=>([...p.tableRects,...Object.values(p.slots)].reduce((sum,r)=>sum+r.width*r.height,0)/(work.width*work.height)*100).toFixed(1);
const panels=plans.map((p,i)=>`<section id="layout-${p.key}" ${i?'hidden':''}><p>${p.grid.columns} columns × ${p.grid.rows} rows · each table ${p.tableRects[0].width} × ${p.tableRects[0].height} px · table coverage ${coverage(p)}% · all tools visible${p.conditional?' · REQUIRES a native 652 × 528 replayer format':''}</p><img src="layout-${p.key}.svg" alt="Fabricated ${p.count}-table workspace"/><a href="layout-${p.key}.svg">Open full-resolution diagram</a></section>`).join('');
fs.writeFileSync(path.join(output,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Poker workspace · offline preview</title><style>body{margin:0;padding:30px;background:#0d121c;color:#e4eaf4;font:16px/1.5 system-ui,sans-serif}main{max-width:1600px;margin:auto}h1{font-size:27px;margin:0 0 8px}p{color:#a8b8ce}nav{display:flex;gap:10px;margin:24px 0}button{font:inherit;padding:9px 22px;border:1px solid #3a4961;background:#182335;color:#d5dfec;border-radius:8px;cursor:pointer}button[aria-pressed=true]{background:#bfdacb;color:#15271d;border-color:#bfdacb}section img{width:100%;display:block;border:1px solid #37445b;border-radius:8px}a{color:#a8cab8}aside{padding:16px 20px;background:#172132;border-radius:8px;margin-top:24px}aside p{margin:8px 0}small{color:#a4b3c9}</style><main><h1>A stable workspace for every table count</h1><p>Offline diagrams at 3840 × 2112 usable pixels, 100% scaling. All content is fabricated. This page does not connect to GG or manage windows.</p><aside><strong>Six-table play block, short shared replay, quiet stake strips</strong><p>Six equal 982 × 702 tables form three columns and two rows. The six-table block is centered. Clock, notes, challenge and the shared 898 × 700 replay region form one centered shelf beneath it.</p><p>Multiple replayers stack exactly in one region and do not reserve extra columns. Opaque wide/thin stake strips cover the promo-banner area. This is a fabricated geometry preview.</p></aside><nav aria-label="Table count">${plans.map((p,i)=>`<button type="button" aria-pressed="${!i}" data-count="${p.key}">${p.label}</button>`).join('')}</nav>${panels}<aside><strong>Number-only bankroll view · future concept</strong><p style="font-size:30px;color:#9bd2b4">+$123.45 <small style="font-size:14px">fabricated example</small></p><p>The current candidate keeps the full tracker window. A compact financial card has no connected data source and is not implemented. No window clipping or screenshots are used.</p></aside><p><small>Table positions stay fixed when tools open or close. Changing table count can select a different grid. Physical screen size, display scaling and native minimums can make a count unavailable; no overlapping fallback is assigned.</small></p></main><script>for(const button of document.querySelectorAll('button'))button.addEventListener('click',()=>{for(const section of document.querySelectorAll('section'))section.hidden=section.id!=='layout-'+button.dataset.count;for(const peer of document.querySelectorAll('button'))peer.setAttribute('aria-pressed',String(peer===button));});</script></html>`);
const comparison=fs.readFileSync(path.join(output,'index.html'),'utf8').replace('</script>',`document.querySelector('button[data-count="6"]').click();</script>`);
fs.writeFileSync(path.join(output,'six-table-comparison.html'),comparison);
console.log(`Static offline preview written to ${path.join(output,'index.html')}`);
