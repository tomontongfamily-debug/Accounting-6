import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {mergeOcrEvidence,pendingOcrAttempt,OCR_ATTEMPT_TIMEOUT_MS,TOTALIZER_VERSION} from '../src/ocr-evidence.js';
import {prepareStationRollout} from '../pilot/station-rollout.mjs';
import {withStationRollout} from '../src/station-rollout.js';
import {midShiftPumpKey} from '../src/mid-shift-price-change.js';

test('a new pending attempt has a server start and a finite 30-second deadline',()=>{
 const now=Date.parse('2026-11-06T10:00:00Z'),attempt=pendingOcrAttempt(now);
 assert.deepEqual(attempt,{status:'pending',version:TOTALIZER_VERSION,startedAt:'2026-11-06T10:00:00.000Z',deadlineAt:'2026-11-06T10:00:30.000Z'});
 assert.equal(Date.parse(attempt.deadlineAt)-Date.parse(attempt.startedAt),OCR_ATTEMPT_TIMEOUT_MS);
});

test('same-photo completed OCR cannot regress to a stale pending marker',()=>{
 for(const status of ['detected','no-reading','error']){
  const prior={photo_path:'/same.jpg',ocr_detected_reading:status==='detected'?10001.12:null,
   ocr_result:{status,version:'completed-reader',reason:'recognition-timeout',startedAt:'2026-11-06T10:00:00Z',deadlineAt:'2026-11-06T10:00:30Z',completedAt:'2026-11-06T10:00:20Z',durationMs:20000}};
  const result=mergeOcrEvidence(prior,{photo_path:'/same.jpg',readingConfirmed:true,ocr_detected_reading:null,ocr_result:{status:'pending',version:'stale-reader'}});
  assert.equal(result.ocr_result.status,status);
  assert.equal(result.ocr_result.version,'completed-reader');
  assert.equal(result.ocr_result.completedAt,'2026-11-06T10:00:20.000Z');
  assert.equal(result.ocr_result.durationMs,20000);
  assert.equal(result.ocr_detected_reading,prior.ocr_detected_reading);
 }
 const replaced=mergeOcrEvidence({photo_path:'/old.jpg',ocr_detected_reading:123,ocr_result:{status:'detected',version:'old'}},{photo_path:'/new.jpg',ocr_detected_reading:null,ocr_result:pendingOcrAttempt()});
 assert.equal(replaced.ocr_result.status,'pending');assert.equal(replaced.ocr_detected_reading,null);
});

test('a manual confirmation records an interrupted attempt without fabricating an OCR reading',()=>{
 const now=Date.parse('2026-11-06T10:00:45Z');
 const prior={photo_path:'/saved.jpg',ocr_detected_reading:null,ocr_result:pendingOcrAttempt(now-45000)};
 const pending=structuredClone(prior);
 const result=mergeOcrEvidence(prior,{photo_path:'/saved.jpg',readingConfirmed:true,closing:253763},{now});
 assert.equal(result.ocr_detected_reading,null);assert.equal(result.ocr_result.status,'error');
 assert.equal(result.ocr_result.reason,'recognition-interrupted');
 assert.equal(result.ocr_result.completedAt,'2026-11-06T10:00:45.000Z');
 assert.equal(result.ocr_result.startedAt,'2026-11-06T10:00:00.000Z');
 assert.equal(result.ocr_result.deadlineAt,'2026-11-06T10:00:30.000Z');
 assert.deepEqual(prior,pending,'Merging is non-mutating; historical evidence is not silently rewritten');
 const terminal=mergeOcrEvidence({...prior,ocr_result:result.ocr_result},{photo_path:'/saved.jpg',readingConfirmed:true,closing:253764,ocr_result:pending.ocr_result},{now:now+1000});
 assert.equal(terminal.ocr_result.completedAt,result.ocr_result.completedAt);
});

test('pending evidence is completed explicitly on a cashier confirmation for closing, opening and price-change photos',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-06T10:00:00Z')});
 for(const kind of ['closing','opening','price-change']){
  let {state,key,cashier,manager}=fixture();
  if(kind==='opening'){
   state.mode='live';state.startDate='2026-10-03';
   prepareStationRollout(state,withStationRollout({mode:'live',start_date:state.startDate}));
   key='Mabolo__2026-11-04__shift-3';cashier={role:'Cashier',branch:'Mabolo'};
  }
  let row=state.reports[key].pumpRows[0];
  const change={id:'price-change-test',product:row.product,effectiveTime:'08:00',newPrice:71,readingPhotos:{},readings:{}};
  if(kind==='price-change')state.reports[key].midShiftPriceChanges=[change];
  const session=kind==='price-change'?manager:cashier;
  const changed=kind==='price-change'?{changeId:change.id,pumpKey:midShiftPumpKey(row)}:{};
  const uploaded=await runAction(state,session,'/api/demo/photo',{reportKey:key,rowId:row.id,revision:0,replaceReading:true,data:'data:image/jpeg;base64,/9j/2Q==',...changed},{mutationId:'pending-'+kind,uploadPhoto:async()=>{}});
  state=uploaded.state;
  row=kind==='price-change'?{...row,...state.reports[key].midShiftPriceChanges[0].readingPhotos[midShiftPumpKey(row)]}:state.reports[key].pumpRows[0];
  const initial=structuredClone(row.ocr_result);
  assert.equal(initial.status,'pending');assert.equal(Date.parse(initial.deadlineAt)-Date.parse(initial.startedAt),30000);
  t.mock.timers.tick(45000);
  const incoming={...row,closing:kind==='opening'?253763:Number(row.opening)+1,closingEntered:true,readingConfirmed:true};
  const saved=await runAction(state,session,kind==='price-change'?'/api/demo/midshift-reading':'/api/demo/pump-reading',
   {reportKey:key,revision:row.readingRevision,row:incoming,...(kind==='price-change'?{changeId:change.id,product:change.product,effectiveTime:change.effectiveTime}:{})});
  const evidence=kind==='price-change'?saved.result.report.midShiftPriceChanges[0].readingPhotos[midShiftPumpKey(row)]:saved.result.report.pumpRows[0];
  assert.equal(evidence.ocr_result.status,'error',kind);assert.equal(evidence.ocr_result.reason,'recognition-interrupted',kind);
  assert.equal(evidence.ocr_result.startedAt,initial.startedAt);assert.equal(evidence.ocr_detected_reading,null);
  assert.equal(evidence.readingConfirmed,true);assert.equal(evidence.ocr_was_edited,false);
  assert.equal(saved.state.audit.findLast(e=>e.rowId===row.id&&e.ocr_result).ocr_result.reason,'recognition-interrupted');
 }
});

test('OCR outcomes survive manual confirmation and stale null fields; retakes retain the previous evidence in audit',async()=>{
 let {state,key,cashier,report}=fixture();
 const act=async(route,input,options={})=>{const out=await runAction(state,cashier,route,input,options);state=out.state;return out.result;};
 let row=report.pumpRows[0];
 const upload=await act('/api/demo/photo',{reportKey:key,rowId:row.id,revision:0,replaceReading:true,data:'data:image/jpeg;base64,/9j/2Q=='},{mutationId:'first-photo',uploadPhoto:async()=>{}});
 row=state.reports[key].pumpRows[0];assert.equal(row.ocr_result.status,'pending');
 assert.equal(upload.report.pilotRevision,state.reports[key].pilotRevision);
 assert.equal(upload.report.pumpRows[0].photo_path,upload.photo_path);
 assert.equal(upload.report.pumpRows[0].readingRevision,upload.readingRevision);
 assert.equal(upload.report.pumpRows[0].readingConfirmed,false);
 assert.equal(upload.report.pumpRows[0].ocr_result.status,'pending');
 const attempt={status:'detected',version:'test-model',completedAt:'2026-11-03T09:00:00Z',durationMs:1234};
 await act('/api/demo/pump-reading',{reportKey:key,revision:row.readingRevision,row:{...row,ocr_detected_reading:10010.12,ocr_result:attempt}});
 row=state.reports[key].pumpRows[0];
 const confirmation={...row,closing:10010.13,closingEntered:true,readingConfirmed:true,ocr_detected_reading:null};delete confirmation.ocr_result;
 await act('/api/demo/pump-reading',{reportKey:key,revision:row.readingRevision,row:confirmation});
 row=state.reports[key].pumpRows[0];assert.equal(row.ocr_detected_reading,10010.12);assert.equal(row.ocr_result.status,'detected');assert.equal(row.ocr_was_edited,true);
 assert.equal(row.ocr_result.durationMs,1234,'Recognition timing survives confirmation without including upload/save time');
 assert.equal(state.audit.findLast(e=>e.rowId===row.id&&e.ocr_result).photo_path,upload.photo_path);
 await act('/api/demo/photo',{reportKey:key,rowId:row.id,revision:row.readingRevision,replaceReading:true,data:'data:image/jpeg;base64,/9j/2Q=='},{mutationId:'replacement-photo',uploadPhoto:async()=>{}});
 row=state.reports[key].pumpRows[0];assert.equal(row.ocr_detected_reading,null);assert.equal(row.ocr_result.status,'pending');assert.equal(row.readingConfirmed,false);
 const event=state.audit.findLast(e=>e.action==='pump-photo-uploaded');assert.equal(event.previousPhoto,upload.photo_path);assert.equal(event.previousOcr,10010.12);
 for(const status of ['error','no-reading']){
   await act('/api/demo/pump-reading',{reportKey:key,revision:row.readingRevision,row:{...row,ocr_result:{status,version:'test-model',completedAt:'2026-11-03T09:01:00Z'}}});
   row=state.reports[key].pumpRows[0];assert.equal(row.ocr_result.status,status);assert.equal(row.ocr_detected_reading,null);
 }
 await act('/api/demo/pump-reading',{reportKey:key,revision:row.readingRevision,row:{...row,closing:10011.12,closingEntered:true,readingConfirmed:true}});
 row=state.reports[key].pumpRows[0];assert.equal(row.ocr_result.status,'no-reading');assert.equal(row.ocr_detected_reading,null);assert.equal(row.closing,10011.12);
});
