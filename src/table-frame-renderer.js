const canvas = document.getElementById('frame');
const context = canvas.getContext('2d');
let lastState = null;
function draw(state) {
  if (!state) return;
  lastState = state;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth*ratio);
  canvas.height = Math.round(innerHeight*ratio);
  context.setTransform(ratio,0,0,ratio,0,0);
  context.clearRect(0,0,innerWidth,innerHeight);
  context.fillStyle = state.color;
  context.globalAlpha = Number.isFinite(state.opacity)?Math.max(.2,Math.min(1,state.opacity)):.85;
  for (const r of state.rects || []) context.fillRect(r.x,r.y,r.width,r.height);
  canvas.dataset.color = state.color;
  canvas.dataset.rectCount = String(state.rects?.length || 0);
  // Read only our own painted overlay canvas, never the underlying table.
  let alpha = 0;
  const sample = state.rects?.[0];
  if (sample && canvas.width && canvas.height) {
    const x = Math.max(0,Math.min(canvas.width-1,Math.floor((sample.x+sample.width/2)*ratio)));
    const y = Math.max(0,Math.min(canvas.height-1,Math.floor((sample.y+sample.height/2)*ratio)));
    alpha = context.getImageData(x,y,1,1).data[3];
  }
  window.stakeFrame.reportDrawn({version:state.version,color:state.color,rectCount:state.rects?.length||0,
    painted:alpha>0,sampledAlpha:alpha,width:innerWidth,height:innerHeight,scale:ratio});
}
window.stakeFrame.onState(draw);
window.addEventListener('resize',() => draw(lastState));
document.addEventListener('visibilitychange',() => { if(!document.hidden)draw(lastState); });
canvas.addEventListener('contextrestored',() => draw(lastState));
