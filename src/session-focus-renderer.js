import {normalizeSessionFocus} from './session-focus-model.js';
import {focusCue} from './focus-cue.js';
const api=window.sessionFocus,root=document.getElementById('lines'),edit=document.getElementById('edit'),hide=document.getElementById('hide');
const status=document.getElementById('status'),retry=document.getElementById('retry'),placeholder='Situation → adjustment → condition';
const options={position:['BB vs BTN','BB vs SB','BTN vs blinds','SB vs BB','BTN vs SB','CO vs BTN'],pot:['Single-raised pot','3-bet pot','4-bet pot','Unopened / preflop'],street:['Preflop','Flop','Turn','River','Flop / Turn'],action:['Call more','Raise less','Defend more','Tighten calls','Bet selected hands','Value-bet thinner','Bluff selected hands','4-bet more','Value only']};
for(const [field,values]of Object.entries(options)){const list=document.createElement('datalist');list.id='choices-'+field;for(const value of values){const o=document.createElement('option');o.value=value;list.append(o);}document.body.append(list);}
const library=document.getElementById('library'),reviewGuide=document.getElementById('review-guide');
const evidenceLabels={personal:'Personal pattern',population:'Population exploit',testing:'Testing'};
let model=normalizeSessionFocus(),editing=false,libraryMode=false,loaded=false,chain=Promise.resolve(),pending=0,lastFailure=null;
function selected(){return (model.selected??[0,1,2]).filter(i=>i<model.lines.length&&model.drills?.[i]?.state!=='parked');}
const dirty=new Set(),versions=new Map(),key=(i,f)=>i+':'+f;
function message(text,error=false){status.textContent=text;status.parentElement.classList.toggle('error',error);retry.hidden=!error;}
function feedback(){message(pending?'Saving…':lastFailure?'Save failed — edits kept.':dirty.size?'Unsaved edits':'Saved locally',!!lastFailure&&!pending);}
function value(i,field){return field==='detail'?(model.drills?.[i]?.detail??model.lines[i]):model.drills?.[i]?.[field]||'';}
function paint(){
 edit.textContent=editing?'Done':'Edit';edit.disabled=!loaded;hide.disabled=!loaded;
 library.textContent=libraryMode?'Session ('+selected().length+')':'Library';library.disabled=!loaded;reviewGuide.hidden=!libraryMode||editing;
 root.classList.toggle('playing',!libraryMode&&!editing);
 if(editing){root.querySelectorAll('[data-field]').forEach(input=>{const i=Number(input.dataset.index),f=input.dataset.field;if(!dirty.has(key(i,f)))input.value=value(i,f);});return;}
 const scroll=root.scrollTop;root.replaceChildren();root.classList.remove('editing');
 const indexes=libraryMode?model.lines.map((_,i)=>i):selected();
 if(!indexes.length){const empty=document.createElement('p');empty.className='empty-session';empty.textContent='Choose up to three drills in Library.';root.append(empty);}
 indexes.forEach(index=>{
  const detail=value(index,'detail'),d=model.drills?.[index];
  const button=document.createElement('button');button.type='button';button.className='line'+(index===model.active&&detail?' active':'');button.dataset.index=String(index);button.title='Select focus · Edit for full details';
  const number=document.createElement('span');number.className='number';number.textContent=String(index+1);
  const content=document.createElement('span');content.className='drill-content';
  const preview=focusCue(d||{detail});
  if(preview.context){const context=document.createElement('span');context.className='cue-context';context.textContent=preview.context;content.append(context);}
  const evidence=document.createElement('span');evidence.className='evidence';evidence.textContent=evidenceLabels[d?.evidence]||'Testing';content.append(evidence);
  const title=document.createElement('span');title.className='cue-title';title.textContent=detail?preview.title:'Add a practice cue';content.append(title);
  const copy=document.createElement('span');copy.className='copy'+(!detail?' empty':'');copy.textContent=detail?preview.cue:'Edit to add your reminder';content.append(copy);
  button.append(number,content);button.addEventListener('click',()=>{if(selected().includes(index))void save({active:index});});
  if(libraryMode){
   const row=document.createElement('div');row.className='library-row'+(d?.state==='parked'?' parked':'');
   const pin=document.createElement('button');pin.type='button';pin.dataset.pin=String(index);const included=selected().includes(index);
   pin.textContent=included?'Remove':d?.state==='parked'?'Parked':'Add';pin.disabled=pending>0||(!included&&(selected().length>=3||d?.state==='parked'));
   pin.setAttribute('aria-label',(included?'Remove from session: ':'Add to session: ')+(index+1));
   pin.addEventListener('click',()=>{const current=selected();void save({selected:current.includes(index)?current.filter(i=>i!==index):[...current,index].slice(0,3)});});
   row.append(button,pin);root.append(row);
  }else root.append(button);
 });root.scrollTop=scroll;
}
function receive(next){next=normalizeSessionFocus(next);if(next.revision>=model.revision)model=next;if(!model.enabled&&editing&&!dirty.size)editing=false;paint();}
function save(patch,submitted={}){
 pending++;feedback();root.querySelectorAll('[data-pin]').forEach(button=>{button.disabled=true;});const request=chain.catch(()=>{}).then(()=>api.update(patch));chain=request;
 return request.then(next=>{for(const [k,v]of Object.entries(submitted))if(versions.get(k)===v)dirty.delete(k);receive(next);lastFailure=null;return true;})
 .catch(()=>{lastFailure={patch,submitted};return false;}).finally(()=>{pending--;feedback();paint();});
}
function patchFor(i,f,v){return {drillEdits:{[i]:{[f]:v}}};}
function changedRows(){
 const drillEdits={},lineEdits={},submitted={};
 for(const k of dirty){const [index,f]=k.split(':'),input=root.querySelector(`[data-index="${index}"][data-field="${f}"]`);if(!input)continue;
  if(f==='detail'&&!model.drills)lineEdits[index]=input.value;else{drillEdits[index]??={};drillEdits[index][f]=input.value;}submitted[k]=versions.get(k);
 }return {patch:{drillEdits,lineEdits},submitted};
}
async function flush(){const {patch,submitted}=changedRows();if(!(await save(patch,submitted)))return false;return dirty.size===0;}
function startEdit(){
 editing=true;dirty.clear();paint();root.replaceChildren();root.classList.add('editing');
 model.lines.forEach((_,index)=>{
  const card=document.createElement('section');card.className='drill-editor';const title=document.createElement('strong');title.textContent='Drill '+(index+1);card.append(title);
  const fields=document.createElement('div');fields.className='module-fields';
  for(const f of ['position','pot','street','action','cue','evidence','state','detail']){
   const label=document.createElement('label');label.textContent=f==='detail'?'Condition / reminder':f==='pot'?'Pot / line':f==='action'?'Adjustment':f==='cue'?'Short cue':f==='state'?'After-session review':f[0].toUpperCase()+f.slice(1);
   const input=document.createElement(f==='detail'?'textarea':['evidence','state'].includes(f)?'select':'input');
   if(f==='evidence'||f==='state'){const choices=f==='evidence'?evidenceLabels:{practice:'Keep practising',review:'Needs review',parked:'Park for now'};for(const [v,text]of Object.entries(choices)){const option=document.createElement('option');option.value=v;option.textContent=text;input.append(option);}}
   input.value=value(index,f)||(f==='evidence'?'testing':f==='state'?'practice':'');input.dataset.index=String(index);input.dataset.field=f;
   input.setAttribute('aria-label',f==='detail'?'Focus '+(index+1):f+' '+(index+1));
   if(f==='detail'){input.rows=3;input.placeholder=placeholder;}else{input.setAttribute('list','choices-'+f);input.placeholder='Optional';}
   const update=e=>{if(e?.isComposing)return;const limit=f==='detail'?2400:f==='cue'?90:80;input.value=Array.from(input.value).slice(0,limit).join('');const k=key(index,f),v=(versions.get(k)||0)+1;versions.set(k,v);dirty.add(k);void save(patchFor(index,f,input.value),{[k]:v});};
   input.addEventListener('input',update);input.addEventListener('compositionend',update);label.append(input);(f==='detail'?card:fields).append(label);
  }
  card.insertBefore(fields,card.children[1]);root.append(card);
 });root.querySelector('input')?.focus();
}
edit.addEventListener('click',async()=>{if(!editing){startEdit();return;}if(await flush()){editing=false;paint();}});
library.addEventListener('click',async()=>{if(editing&&!(await flush()))return;editing=false;libraryMode=!libraryMode;paint();});
async function hidePanel(){if(editing){if(!(await flush()))return;editing=false;paint();}await save({enabled:false});}
hide.addEventListener('click',()=>{void hidePanel();});
async function load(){try{receive(await api.get());loaded=true;lastFailure=null;paint();feedback();}catch{lastFailure={load:true};message('Couldn’t load session focus.',true);}}
retry.addEventListener('click',()=>{if(lastFailure?.load){void load();return;}if(lastFailure?.patch?.enabled===false){void hidePanel();return;}if(editing){void flush();return;}if(lastFailure?.patch)void save(lastFailure.patch,lastFailure.submitted);});
api?.onChange(receive);api?.onFailure?.(patch=>{lastFailure={patch};feedback();});
document.addEventListener('keydown',event=>{if(editing&&(event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();edit.click();}});
if(api)void load();
