export function normalizeComfort(raw={}) {
  const minutes=Number(raw?.breakMinutes);
  const position=raw?.clockPosition;
  return {clockMode:raw?.clockMode==='table'?'table':'shared',breakEnabled:raw?.breakEnabled!==false,
    breakMinutes:Number.isFinite(minutes)?Math.max(15,Math.min(180,Math.round(minutes))):50,
    clockPosition:position && Number.isFinite(position.x)&&Number.isFinite(position.y)?{x:Math.round(position.x),y:Math.round(position.y)}:null};
}
export function formatSession(seconds) {
  const n=Math.max(0,Math.floor(seconds));
  return [Math.floor(n/3600),Math.floor(n/60)%60,n%60].map(v=>String(v).padStart(2,'0')).join(':');
}
export class SessionComfort {
  constructor(now=Date.now()) {this.playing=false;this.visible=false;this.reset(now);}
  reset(now=Date.now()) {this.last=now;this.elapsed=0;this.breakAt=0;this.snoozeUntil=0;this.breakUntil=0;}
  tick(now,active) {this.elapsed+=active&&this.playing?Math.max(0,now-this.last):0;this.last=now;this.visible=active;}
  setPlaying(playing,now=Date.now()) {this.tick(now,this.visible);if(playing===true&&this.breakUntil)this.completeBreak();this.playing=playing===true;}
  startBreak(now=Date.now()) {if(this.breakUntil)return;this.tick(now,this.visible);this.playing=false;this.breakUntil=now+600000;}
  status(raw={},now=Date.now()) {
    const cfg=normalizeComfort(raw);
    const dueAt=Math.max(this.breakAt+cfg.breakMinutes*60000,this.snoozeUntil);
    const remaining=this.breakUntil?Math.max(0,Math.ceil((this.breakUntil-now)/1000)):0;
    return {seconds:Math.floor(this.elapsed/1000),session:formatSession(this.elapsed/1000),playing:this.playing,paused:!this.playing||!this.visible,
      breakActive:!!this.breakUntil&&remaining>0,breakReady:!!this.breakUntil&&remaining===0,breakRemainingSeconds:remaining,
      breakDue:cfg.breakEnabled && !this.breakUntil && this.elapsed>=dueAt};
  }
  snooze() {if(!this.breakUntil)this.snoozeUntil=this.elapsed+600000;}
  completeBreak() {this.breakAt=this.elapsed;this.snoozeUntil=0;this.breakUntil=0;}
}
export function sharedClockRect(work,position=null,requestedHeight=148) {
  const width=Math.min(324,work.width),height=Math.min(requestedHeight,work.height);
  return {x:Math.round(Math.max(work.x,Math.min(work.x+work.width-width,position?.x??work.x+(work.width-width)/2))),
    y:Math.round(Math.max(work.y,Math.min(work.y+work.height-height,position?.y??work.y+12))),width,height};
}
export function defaultClockPosition(work,tables=[]) {
  const candidates=[sharedClockRect(work)];
  for(const t of tables) {
    candidates.push(sharedClockRect(work,{x:t.x-336,y:t.y+(t.height-148)/2}),
      sharedClockRect(work,{x:t.x+t.width+12,y:t.y+(t.height-148)/2}),
      sharedClockRect(work,{x:t.x+(t.width-324)/2,y:t.y-160}),
      sharedClockRect(work,{x:t.x+(t.width-324)/2,y:t.y+t.height+12}));
  }
  const overlap=r=>tables.reduce((sum,t)=>sum+Math.max(0,Math.min(r.x+r.width,t.x+t.width)-Math.max(r.x,t.x))*Math.max(0,Math.min(r.y+r.height,t.y+t.height)-Math.max(r.y,t.y)),0);
  return candidates.sort((a,b)=>overlap(a)-overlap(b))[0];
}
