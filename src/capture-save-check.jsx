import React from 'react';
import {createRoot} from 'react-dom/client';
import {PhotoReading,savePumpReading} from './upgrade-components.jsx';
import {completedPhotoOcrEvidence} from './ocr-evidence.js';

// Completely isolated functional fixture. Its fetch stub never delegates to
// the network, and no account, station photo or signed URL is used.
window.__fueltechPilotConfig={mode:'shadow',start_date:'2026-11-06'};
const editDemo=new URLSearchParams(location.search).get('edit')==='1';
const report={branch:'Latency demo',date:'2026-11-06',shiftId:'shift-2',pilotRevision:1,
  pumpRows:(editDemo?[1]:[1,2]).map(number=>({id:'isolated-'+number,pump:'Pump '+number,nozzle:'Regular',product:'Regular',opening:10000,closing:'',readingRevision:0,readingConfirmed:false}))};
const calls=[],shown=new Map(),started=performance.now();
const evidence=document.getElementById('evidence'),cards=document.getElementById('cards');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let errors=[],complete=false;
window.fetch=async(url,options)=>{
  if(url!=='/api/pilot/action')throw Error('Network blocked in isolated fixture.');
  const {route,input,mode}=JSON.parse(options.body);
  if(mode!=='shadow'||input.reportKey!=='Latency demo__2026-11-06__shift-2')throw Error('Only the isolated fixture is allowed.');
  calls.push({route,joined:!!input.readyOcr});await delay(6000);
  const row=report.pumpRows.find(item=>item.id===(input.rowId||input.row?.id));
  if(!row)throw Error('Unknown isolated row.');
  let result;
  if(route==='/api/demo/photo'){
    const ocr=completedPhotoOcrEvidence(input.data,input.readyOcr);
    Object.assign(row,{photo_path:input.data,closing:'',readingConfirmed:false,readingRevision:row.readingRevision+1,...(ocr||{ocr_detected_reading:null,ocr_result:{status:'pending'}})});
    result={ok:true,photo_path:row.photo_path,readingRevision:row.readingRevision,report:structuredClone(report),...(ocr?{ocrPersisted:true}:{})};
  }else if(route==='/api/demo/pump-reading'){
    Object.assign(row,input.row,{readingRevision:row.readingRevision+1});result={ok:true,report:structuredClone(report)};
  }else throw Error('Action blocked in isolated fixture.');
  return {ok:true,status:200,json:async()=>result};
};
const drawing=document.createElement('canvas');drawing.width=800;drawing.height=400;
const ctx=drawing.getContext('2d');ctx.fillStyle='#d6e3b7';ctx.fillRect(0,0,800,400);ctx.fillStyle='#10241b';ctx.font='90px monospace';ctx.fillText('10010.12',70,230);
// Android produces video frames only while the source canvas keeps drawing.
// A single initial paint can leave a newly attached stream permanently empty.
setInterval(()=>ctx.fillRect(0,0,1,1),100);
const media={getUserMedia:async()=>drawing.captureStream(20)};
Object.defineProperty(navigator,'mediaDevices',{value:media,configurable:true});
const recognize=async()=>{await delay(500);return {reading:10010.12,attempt:{status:'detected',version:'SIMULATED-reader',durationMs:500,completedAt:new Date().toISOString()}};};
if(editDemo){
  Object.assign(report.pumpRows[0],{photo_path:drawing.toDataURL('image/jpeg',.95),ocr_detected_reading:10070.12,ocr_result:{status:'detected',version:'SIMULATED-reader',durationMs:500},readingRevision:1});
  document.querySelector('h1').textContent='Check and edit a meter reading';
  document.querySelector('body>p').textContent='Isolated app demo. The sample photo says 10010.12; the simulated OCR suggestion is wrong. Tap Edit number to compare and correct it. No station records are changed.';
}
function update(){
  if(editDemo){evidence.textContent='App demo · sample photo and simulated OCR\nEdit the number using the enlarged photo.';return;}
  for(const card of cards.querySelectorAll('[data-pump-row-id]')){
    if([...card.querySelectorAll('[role=status]')].some(node=>node.textContent.includes('Reading found:'))&&!shown.has(card.dataset.pumpRowId))shown.set(card.dataset.pumpRowId,Math.round(performance.now()-started));
  }
  const ready=[...cards.querySelectorAll('button')].filter(button=>button.textContent==='Yes, confirm reading'&&!button.disabled).length;
  const passed=ready===2&&calls.length===2&&calls.every(call=>call.route==='/api/demo/photo'&&call.joined)&&report.pumpRows.every(row=>!row.readingConfirmed);
  evidence.textContent=`${passed?'PASS':complete?'FAIL':'RUNNING'} · actual Android form / simulated reader\nReader delay: 500 ms; each save delay: 6000 ms\nReadings displayed before saving: ${shown.size}/2\nPhoto requests: ${calls.filter(call=>call.route==='/api/demo/photo').length}\nExtra reading-save requests: ${calls.filter(call=>call.route==='/api/demo/pump-reading').length}\nReady for human confirmation: ${ready}/2\nAutomatically confirmed: ${report.pumpRows.filter(row=>row.readingConfirmed).length}\nElapsed: ${((performance.now()-started)/1000).toFixed(1)} s${errors.length?'\nERROR: '+errors.join('; '):''}`;
  if(passed)complete=true;
}
const observer=new MutationObserver(update);observer.observe(cards,{subtree:true,childList:true,characterData:true,attributes:true});
const root=createRoot(cards);
root.render(<>{report.pumpRows.map(row=><PhotoReading key={row.id} row={row} report={report} recognize={recognize} onConfirm={async(next,savedPhoto,options)=>{
  const saved=savedPhoto||await savePumpReading(report,next,options);return saved.report.pumpRows.find(item=>item.id===next.id);
}}/>)}</>);
async function until(predicate){const end=performance.now()+10000;while(!predicate()){if(performance.now()>end)throw Error('Fixture control did not become ready.');await delay(50);}}
async function run(){
  try{
    await until(()=>cards.querySelectorAll('article').length===2);
    for(const card of cards.querySelectorAll('article')){
      [...card.querySelectorAll('button')].find(button=>button.textContent==='Open camera').click();
      await until(()=>card.querySelector('video')?.readyState>=2);
      [...card.querySelectorAll('button')].find(button=>button.textContent==='Capture photo').click();
      await until(()=>!card.querySelector('video'));
    }
  }catch(error){errors.push(error.message);complete=true;update();}
}
const tick=setInterval(()=>{if(complete){clearInterval(tick);return;}if(performance.now()-started>45000){errors.push('Fixture exceeded 45 seconds.');complete=true;}update();},200);
if(editDemo){complete=true;update();}else run();
