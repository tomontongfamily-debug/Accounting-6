import React from 'react';
import {createRoot} from 'react-dom/client';
import {PhotoReading,savePumpReading} from './upgrade-components.jsx';
import {completedPhotoOcrEvidence} from './ocr-evidence.js';
import {HighVarianceNotice} from './high-variance-notice.jsx';
import {isHighVariance} from './error-reduction.ts';

// Completely isolated functional fixture. Its fetch stub never delegates to
// the network, and no account, station photo or signed URL is used.
window.__fueltechPilotConfig={mode:'shadow',start_date:'2026-11-06'};
const editDemo=new URLSearchParams(location.search).get('edit')==='1';
const confirmDemo=editDemo&&new URLSearchParams(location.search).get('confirm')==='1';
const verifyConfirmation=confirmDemo&&new URLSearchParams(location.search).get('verify')==='1';
const varianceDemo=new URLSearchParams(location.search).get('variance');
const report={branch:'Latency demo',date:'2026-11-06',shiftId:'shift-2',pilotRevision:1,
  pumpRows:(editDemo?[1]:[1,2]).map(number=>({id:'isolated-'+number,pump:'Pump '+number,nozzle:'Regular',product:'Regular',opening:10000,closing:'',readingRevision:0,readingConfirmed:false}))};
const calls=[],shown=new Map(),started=performance.now();
const evidence=document.getElementById('evidence'),cards=document.getElementById('cards');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let errors=[],complete=false,confirmationAudit='',demoGeneration=0;
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
  Object.assign(report.pumpRows[0],{photo_path:drawing.toDataURL('image/jpeg',.95),ocr_detected_reading:confirmDemo?10010.12:10070.12,ocr_result:{status:'detected',version:'SIMULATED-reader',durationMs:500},readingRevision:1});
  document.querySelector('h1').textContent='Check and edit a meter reading';
  document.querySelector('body>p').textContent=confirmDemo?'Isolated app demo. Check the sample reading, then confirm a second time. No station records are changed.':'Isolated app demo. The sample photo says 10010.12; the simulated OCR suggestion is wrong. Tap Edit number to compare and correct it. No station records are changed.';
}
function update(){
  if(varianceDemo)return;
  if(editDemo){evidence.textContent='App demo · sample photo and simulated OCR\n'+(confirmationAudit||'Edit the number using the enlarged photo.')+(errors.length?'\nERROR: '+errors.join('; '):'');return;}
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
function renderDemo(){root.render(<>{report.pumpRows.map(row=><PhotoReading key={row.id+':'+demoGeneration} row={row} report={report} recognize={recognize} onConfirm={async(next,savedPhoto,options)=>{
  const saved=savedPhoto||await savePumpReading(report,next,options);return saved.report.pumpRows.find(item=>item.id===next.id);
}}/>)}</>);}
if(!varianceDemo)renderDemo();
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
async function runConfirmationDemo(){
  const first=()=>[...cards.querySelectorAll('button')].find(button=>button.textContent==='Yes, confirm reading');
  const dialog=()=>cards.querySelector('dialog[open]');
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  try{
    await until(()=>first());first().click();await until(()=>dialog());
    check(calls.length===0&&!report.pumpRows[0].readingConfirmed,'First confirmation must not save.');
    if(verifyConfirmation){
      await until(()=>dialog()?.querySelector('img')?.complete&&dialog()?.querySelector('img')?.naturalWidth>0);
      const reviewStarted=performance.now();
      check(!dialog().querySelector('.reading-final-sure'),'Final button must be hidden while review starts.');
      await delay(2500);
      check(!dialog().querySelector('.reading-final-sure')&&calls.length===0,'Final button must stay hidden during the three-second review.');
      await until(()=>dialog()?.querySelector('.reading-final-sure'));
      check(performance.now()-reviewStarted>=2900,'Final button appeared before three seconds of photo review.');
      const draft=cards.querySelector('input[inputmode=decimal]').value;
      dialog().querySelector('.reading-final-cancel').click();await until(()=>!dialog());
      check(calls.length===0&&!report.pumpRows[0].readingConfirmed,'Cancel must not save.');
      check(cards.querySelector('input[inputmode=decimal]').value===draft,'Cancel must retain the draft.');
      first().click();await until(()=>dialog());
      check(!dialog().querySelector('.reading-final-sure'),'Reopening must restart the review delay.');
      await until(()=>dialog()?.querySelector('.reading-final-sure'));dialog().querySelector('.reading-final-sure').click();
      await until(()=>report.pumpRows[0].readingConfirmed&&!dialog());
      check(calls.length===1&&calls[0].route==='/api/demo/pump-reading','Final confirmation must save exactly once.');
      Object.assign(report.pumpRows[0],{readingConfirmed:false,closing:'',closingEntered:false});
      demoGeneration++;renderDemo();await until(()=>first());first().click();await until(()=>dialog());
      confirmationAudit='PASS · 3-second review · reopening restarts delay · first press: 0 saves · cancel: 0 saves · final green button: 1 save (isolated fixture).';
    }
  }catch(error){errors.push(error.message);}
  update();
}
if(varianceDemo){
  complete=true;
  document.querySelector('h1').textContent='High variance notification';
  document.querySelector('body>p').textContent='Isolated app demo. This is the actual report notification with sample data. No station report is changed.';
  const passed=!isHighVariance(1000)&&isHighVariance(1000.01)&&!isHighVariance(-3000)&&isHighVariance(-3000.01);
  const audit=`${passed?'PASS':'FAIL'} · submission limits: above +1,000 or below -3,000. Exact boundaries allowed.`;
  evidence.textContent=audit;
  root.render(<HighVarianceNotice variance={varianceDemo==='overage'?1000.01:-3000.01}
    onReviewCash={()=>{evidence.textContent=audit+'\nReview cash count selected.';}}
    onReviewPumps={()=>{evidence.textContent=audit+'\nReview pump readings selected.';}}
    onReviewPayments={()=>{evidence.textContent=audit+'\nReview payments and deductions selected.';}}/>);
}else if(editDemo){complete=true;update();if(confirmDemo)runConfirmationDemo();}else run();
