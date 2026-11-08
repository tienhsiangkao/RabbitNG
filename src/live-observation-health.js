export class LiveObservationHealth{
 constructor({now=()=>performance.now(),durationMs=120000,maxGapMs=5000}={}){this.now=now;this.durationMs=durationMs;this.maxGapMs=maxGapMs;this.start=this.last=now();this.samples=0;}
 check(){const time=this.now();if(time-this.last>this.maxGapMs)throw Error('Live metadata observation gap exceeded five seconds');if(time-this.start>this.durationMs+6000)throw Error('Live test deadline exceeded');return time;}
 sample(){this.last=this.check();this.samples++;}
 complete(){const time=this.check();if(time-this.start<this.durationMs||this.samples<100)throw Error('Incomplete live observation interval');}
}
export async function boundedRendererRead(read,timeoutMs=1000){
 let timer;try{return await Promise.race([Promise.resolve().then(read),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Own renderer read timed out')),timeoutMs);})]);}finally{clearTimeout(timer);}
}
