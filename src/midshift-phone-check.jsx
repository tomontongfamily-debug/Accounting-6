import React from 'react';
import {createRoot} from 'react-dom/client';
import {createReport} from './accounting-engine.js';
import {MidShiftPhotoReadings,demoApi} from './upgrade-components.jsx';
import {midShiftPumpKey,midShiftPhotoRow,midShiftReadingComplete} from './mid-shift-price-change.js';
import {ALL_STATIONS} from './station-rollout.js';

// No request delegates to the network. Only synthetic evidence can be saved.
window.__fueltechPilotConfig={mode:'shadow',start_date:'2026-11-06'};
const cards=document.getElementById('cards'),evidence=document.getElementById('evidence');
const root=createRoot(cards),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let report,change,generation=0,releaseUpload,failures=0,firstId,requests=0;
const audit=[],pending=new Map();
const check=(condition,message)=>{if(!condition)throw Error(message);};
const show=message=>{evidence.textContent=[...audit,message].join('\n');};
const button=(scope,text)=>[...scope.querySelectorAll('button')].find(node=>node.textContent===text);
const active=()=>[...cards.querySelectorAll('.reading-card')].find(node=>node.parentElement.style.display!=='none');
const mounted=()=>cards.querySelector('[data-fixture-case]')?.dataset.fixtureCase===String(generation);
async function until(predicate){const end=performance.now()+15000;while(!predicate()){if(performance.now()>end)throw Error('Timed out waiting for phone form.');await delay(30);}}
function setup(branch,product){
  report=createReport(branch,'2026-11-12',{Premium:70,Regular:65,Diesel:60},'shift-1');
  report.pumpRows=report.pumpRows.map(row=>({...row,opening:10000,closing:10020,closingEntered:true,readingConfirmed:true,photo_path:'original-closing'}));
  change={id:'isolated-'+(++generation),product,effectiveTime:'11:00',newPrice:71,readings:{},readingPhotos:{}};
  report.midShiftPriceChanges=[change];
  render();
}
function render(){root.render(<div data-fixture-case={generation}><MidShiftPhotoReadings key={generation} report={structuredClone(report)} change={structuredClone(change)} recognize={async()=>{await delay(100);return {reading:10010.12,attempt:{status:'detected',version:'SIMULATED-reader',durationMs:100}};}}
  onReading={async(current,next,savedPhoto,options)=>{
    const saved=savedPhoto||await demoApi('midshift-reading',{reportKey:`${report.branch}__${report.date}__${report.shiftId}`,changeId:current.id,row:next,revision:next.readingRevision},options);
    render();return midShiftPhotoRow(saved.report.midShiftPriceChanges[0],next,saved.report);
  }}/></div>);}
window.fetch=async(url,options)=>{
  check(url==='/api/pilot/action','Unexpected network request blocked.');
  const {route,input,mode,mutationId}=JSON.parse(options.body);
  check(mode==='shadow'&&input.changeId===change.id,'Only the isolated price change is allowed.');
  const row=report.pumpRows.find(item=>item.id===(input.rowId||input.row?.id));
  check(row,'Unknown isolated nozzle.');requests++;
  if(route==='/api/demo/photo'&&row.id===firstId&&failures<2){
    await new Promise(resolve=>{releaseUpload=resolve;});failures++;
    return {ok:false,status:503,json:async()=>({ok:false,error:'Simulated interrupted upload'})};
  }
  const key=midShiftPumpKey(row),previous=change.readingPhotos[key]||{};
  check(Number(input.revision)===Number(previous.readingRevision||0),'Nozzle revision was overwritten.');
  if(route==='/api/demo/photo'){
    pending.set(row.id,mutationId);
    change.readingPhotos[key]={photo_path:input.data,readingRevision:Number(previous.readingRevision||0)+1,readingConfirmed:false,
      ocr_detected_reading:input.readyOcr?.reading??null,ocr_result:input.readyOcr?.attempt||{status:'pending'}};
    change.readings[key]='';
  }else{
    check(route==='/api/demo/midshift-reading','Unexpected mutation blocked.');
    change.readingPhotos[key]={...previous,...input.row,readingRevision:Number(previous.readingRevision||0)+1};
    change.readings[key]=input.row.readingConfirmed?input.row.closing:'';
  }
  const saved=structuredClone(report),photo=change.readingPhotos[key];
  return {ok:true,status:200,json:async()=>({ok:true,report:saved,photo_path:photo.photo_path,readingRevision:photo.readingRevision,
    ...(input.readyOcr?{ocrPersisted:true}:{})})};
};
const drawing=document.createElement('canvas');drawing.width=800;drawing.height=400;
const ctx=drawing.getContext('2d');ctx.fillStyle='#d6e3b7';ctx.fillRect(0,0,800,400);ctx.fillStyle='#10241b';ctx.font='90px monospace';ctx.fillText('10010.12',70,230);
setInterval(()=>ctx.fillRect(0,0,1,1),100);
Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>drawing.captureStream(20)},configurable:true});
async function run(){
  try{
    let nozzles=0;
    for(const branch of ALL_STATIONS)for(const product of ['Premium','Regular','Diesel']){
      setup(branch,product);await until(mounted);
      for(const tab of cards.querySelectorAll('.pump-tabs button')){
        check(!tab.disabled,`${branch}: a nozzle is inaccessible.`);tab.click();
        await until(()=>tab.getAttribute('aria-pressed')==='true');nozzles++;
      }
    }
    audit.push(`PASS · 6 stations / 3 products / ${nozzles} nozzles accessible`);show('Testing Barili slow/interrupted upload…');
    setup('Barili','Premium');await until(()=>mounted()&&active()?.dataset.pumpRowId===report.pumpRows[0].id);
    const closing=JSON.stringify(report.pumpRows),rows=report.pumpRows.filter(row=>row.product==='Premium');firstId=rows[0].id;
    for(const row of rows){
      const tab=[...cards.querySelectorAll('.pump-tabs button')].find(node=>node.textContent.startsWith(`${row.pump} · ${row.nozzle}`));
      check(!tab.disabled,'Photo upload blocked another pump.');tab.click();await until(()=>active()?.dataset.pumpRowId===row.id);
      button(active(),'Open camera').click();await until(()=>active().querySelector('video')?.readyState>=2);
      check([...cards.querySelectorAll('.pump-tabs button')].every(node=>node.disabled),'Camera must retain its nozzle.');
      button(active(),'Capture photo').click();await until(()=>!active().querySelector('video'));
      await until(()=>[...cards.querySelectorAll('.pump-tabs button')].every(node=>!node.disabled));
    }
    check(failures===0&&pending.size===0,'First upload must still be pending while all pumps are photographed.');
    audit.push('PASS · Pumps 1–4 photographed while first upload waits');show('Checking interrupted save and confirmation…');
    for(let attempt=0;attempt<2;attempt++){await until(()=>releaseUpload);const release=releaseUpload;releaseUpload=null;release();await until(()=>failures===attempt+1);}
    const firstTab=cards.querySelector('.pump-tabs button');firstTab.click();await until(()=>button(active(),'Retry saving photo'));
    check([...cards.querySelectorAll('.pump-tabs button')].every(node=>!node.disabled),'Retry must not block other pumps.');
    button(active(),'Retry saving photo').click();
    for(const row of rows){
      const tab=[...cards.querySelectorAll('.pump-tabs button')].find(node=>node.textContent.startsWith(`${row.pump} · ${row.nozzle}`));tab.click();
      await until(()=>active()?.dataset.pumpRowId===row.id&&button(active(),'Yes, confirm reading'));
      button(active(),'Yes, confirm reading').click();await until(()=>cards.querySelector('dialog[open] .reading-final-sure'));
      cards.querySelector('dialog[open] .reading-final-sure').click();await until(()=>midShiftReadingComplete(report,change,row));
    }
    check(JSON.stringify(report.pumpRows)===closing,'Closing readings changed.');
    check(pending.size===rows.length,'Each nozzle must own a saved photo.');
    audit.push(`PASS · interrupted upload retried / ${rows.length} of ${rows.length} confirmed`,'PASS · closing readings unchanged / no online writes');
    show(`PASS · Android check complete · ${requests} simulated requests`);
    window.scrollTo(0,0);
  }catch(error){show('FAIL · '+error.message);window.scrollTo(0,0);}
}
run();
