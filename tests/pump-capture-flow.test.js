import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizePumpPhotoInput,captureDuration,PHOTO_OCR_JOIN_MS} from '../src/pump-capture-flow.js';
import {completedPhotoOcrEvidence,mergeOcrEvidence} from '../src/ocr-evidence.js';
import {runAction} from '../pilot/service.mjs';
import {fixture} from './pilot-fixture.mjs';
import {prepareStationRollout} from '../pilot/station-rollout.mjs';
import {withStationRollout} from '../src/station-rollout.js';
import {midShiftPumpKey} from '../src/mid-shift-price-change.js';

const found=()=>({reading:10010.12,attempt:{status:'detected',version:'latency-fixture',durationMs:500}});
test('a completed reading joins a queued upload once; explicit retries keep identical frozen bytes',async()=>{
 const capture={photoInputFinalized:false,result:found(),captureToReadingMs:610},input={data:'original-photo',revision:2};let persists=0;
 const sent=await finalizePumpPhotoInput(capture,input,async current=>{persists++;assert.equal(current.photoInputFinalized,true);});
 assert.equal(sent.readyOcr.reading,10010.12);assert.equal(sent.readyOcr.attempt.captureToReadingMs,610);
 const original=JSON.stringify(sent);capture.result.reading=999;
 assert.equal(JSON.stringify(await finalizePumpPhotoInput(capture,input,()=>{throw Error('Already frozen');})),original);
 assert.equal(persists,1);assert.equal(input.readyOcr,undefined);
 const legacy={photoInput:{data:'legacy'},result:found()};
 assert.deepEqual(await finalizePumpPhotoInput(legacy,input,()=>{throw Error('Legacy payload must not change');}),{data:'legacy'});
});
test('a quick clear-photo result joins while slow setup releases the upload after the bounded window',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const slow={photoInputFinalized:false,recognition:new Promise(()=>{})};
 let saved=false;const pending=finalizePumpPhotoInput(slow,{data:'slow'},async()=>{saved=true;});
 await Promise.resolve();t.mock.timers.tick(PHOTO_OCR_JOIN_MS-1);assert.equal(saved,false);
 t.mock.timers.tick(1);await pending;assert.equal(saved,true);assert.equal(slow.photoInput.readyOcr,undefined);
 const quick={photoInputFinalized:false};quick.recognition=Promise.resolve().then(()=>{quick.result=found();});
 assert.equal((await finalizePumpPhotoInput(quick,{data:'quick'},async()=>{})).readyOcr.reading,10010.12);
 t.mock.timers.reset();
});
test('pending, malformed and conflicting outcomes cannot be attached as completed OCR',()=>{
 for(const result of [{reading:null,attempt:{status:'pending'}},{reading:null,attempt:{status:'detected'}},{reading:'123',attempt:{status:'detected'}},{reading:123,attempt:{status:'no-reading'}},{reading:-1,attempt:{status:'detected'}}])assert.equal(completedPhotoOcrEvidence('/new',result),null);
 assert.equal(completedPhotoOcrEvidence('/new',{reading:null,attempt:{status:'no-reading',version:'safe'}}).ocr_result.status,'no-reading');
 assert.equal(captureDuration({startedAtMs:1000},1600),600);assert.equal(captureDuration({},1600),undefined);
 const evidence=mergeOcrEvidence({}, {photo_path:'/new',ocr_detected_reading:1,ocr_result:{status:'detected',captureToReadingMs:550,captureToReadyMs:15000}});
 assert.equal(evidence.ocr_result.captureToReadingMs,550);assert.equal(evidence.ocr_result.captureToReadyMs,15000);
});
test('atomic photo plus OCR keeps closing, opening and price-change numbers unconfirmed until human review',async()=>{
 for(const kind of ['closing','opening','price-change']){
  let {state,key,cashier,manager}=fixture();
  if(kind==='opening'){state.mode='live';state.startDate='2026-10-03';prepareStationRollout(state,withStationRollout({mode:'live',start_date:state.startDate}));key='Mabolo__2026-11-04__shift-3';cashier={role:'Cashier',branch:'Mabolo'};}
  const row=state.reports[key].pumpRows[0],change={id:'timing-change',product:row.product,effectiveTime:'08:00',newPrice:71,readingPhotos:{},readings:{}};
  if(kind==='price-change')state.reports[key].midShiftPriceChanges=[change];
  const session=kind==='price-change'?manager:cashier;
  const uploaded=await runAction(state,session,'/api/demo/photo',{reportKey:key,rowId:row.id,revision:0,replaceReading:true,data:'data:image/jpeg;base64,/9j/2Q==',readyOcr:found(),...(kind==='price-change'?{changeId:change.id,pumpKey:midShiftPumpKey(row)}:{})},{mutationId:'atomic-'+kind,uploadPhoto:async()=>{}});
  const saved=kind==='price-change'?uploaded.result.report.midShiftPriceChanges[0].readingPhotos[midShiftPumpKey(row)]:uploaded.result.report.pumpRows[0];
  assert.equal(uploaded.result.ocrPersisted,true);assert.equal(saved.ocr_result.status,'detected');assert.equal(saved.ocr_detected_reading,10010.12);
  assert.equal(saved.readingConfirmed,false);assert.equal(saved.closing,'');assert.equal(saved.readingRevision,1);
  if(kind==='opening')assert.equal(saved.opening,'');
  const confirmation={...row,...saved,closing:10010.12,closingEntered:true,readingConfirmed:true};
  const confirmed=await runAction(uploaded.state,session,kind==='price-change'?'/api/demo/midshift-reading':'/api/demo/pump-reading',{reportKey:key,revision:1,row:confirmation,...(kind==='price-change'?{changeId:change.id,product:change.product,effectiveTime:change.effectiveTime}:{})});
  const final=kind==='price-change'?confirmed.result.report.midShiftPriceChanges[0].readingPhotos[midShiftPumpKey(row)]:confirmed.result.report.pumpRows[0];assert.equal(final.readingConfirmed,true);
 }
});
test('completed OCR cannot bypass photo upload failure, revision checks or validation',async()=>{
 const {state,key,cashier,report}=fixture(),row=report.pumpRows[0],input={reportKey:key,rowId:row.id,revision:0,replaceReading:true,data:'data:image/jpeg;base64,/9j/2Q==',readyOcr:found()};
 let uploaded=false;
 await assert.rejects(runAction(state,cashier,'/api/demo/photo',{...input,revision:7},{mutationId:'stale',uploadPhoto:async()=>{uploaded=true;}}),e=>e.status===409);assert.equal(uploaded,false);
 await assert.rejects(runAction(state,cashier,'/api/demo/photo',{...input,readyOcr:{reading:1,attempt:{status:'pending'}}},{mutationId:'invalid',uploadPhoto:async()=>{uploaded=true;}}));assert.equal(uploaded,false);
 await assert.rejects(runAction(state,cashier,'/api/demo/photo',input,{mutationId:'failed',uploadPhoto:async()=>{throw Error('Storage failed');}}),/Storage failed/);
 assert.notEqual(state.reports[key].pumpRows[0].readingConfirmed,true);assert.notEqual(state.reports[key].pumpRows[0].ocr_detected_reading,10010.12);
});
