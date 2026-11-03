import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';

test('OCR outcomes survive manual confirmation and stale null fields; retakes retain the previous evidence in audit',async()=>{
 let {state,key,cashier,report}=fixture();
 const act=async(route,input,options={})=>{const out=await runAction(state,cashier,route,input,options);state=out.state;return out.result;};
 let row=report.pumpRows[0];
 const upload=await act('/api/demo/photo',{reportKey:key,rowId:row.id,revision:0,replaceReading:true,data:'data:image/jpeg;base64,/9j/2Q=='},{mutationId:'first-photo',uploadPhoto:async()=>{}});
 row=state.reports[key].pumpRows[0];assert.equal(row.ocr_result.status,'pending');
 const attempt={status:'detected',version:'test-model',completedAt:'2026-11-03T09:00:00Z'};
 await act('/api/demo/pump-reading',{reportKey:key,revision:row.readingRevision,row:{...row,ocr_detected_reading:10010.12,ocr_result:attempt}});
 row=state.reports[key].pumpRows[0];
 const confirmation={...row,closing:10010.13,closingEntered:true,readingConfirmed:true,ocr_detected_reading:null};delete confirmation.ocr_result;
 await act('/api/demo/pump-reading',{reportKey:key,revision:row.readingRevision,row:confirmation});
 row=state.reports[key].pumpRows[0];assert.equal(row.ocr_detected_reading,10010.12);assert.equal(row.ocr_result.status,'detected');assert.equal(row.ocr_was_edited,true);
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
