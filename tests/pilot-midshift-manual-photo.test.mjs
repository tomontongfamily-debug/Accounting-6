import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {midShiftPumpKey} from '../src/mid-shift-price-change.js';

test('manual mid-shift evidence requires a saved matching photo, enforces bounds and preserves ordinary OCR capture',async()=>{
 const f=fixture(),r=f.state.reports[f.key],row=r.pumpRows[0],key=midShiftPumpKey(row);
 for(const pump of r.pumpRows)Object.assign(pump,{setupRequired:false,closing:Number(pump.opening)+20,closingEntered:true});
 r.midShiftPriceChanges=[{id:'manual',product:row.product,effectiveTime:'09:00',newPrice:69,photoRequired:true,readings:{},readingPhotos:{}}];
 let state=f.state;
 const act=async(route,input)=>{const out=await runAction(state,f.cashier,route,input,{uploadPhoto:async()=>{}});state=out.state;return out.result;};
 const context={reportKey:f.key,changeId:'manual',product:row.product,effectiveTime:'09:00'};
 const input={...context,rowId:row.id,pumpKey:key,replaceReading:true,revision:0,readingMethod:'manual',data:'data:image/jpeg;base64,/9j/2Q=='};
 await assert.rejects(act('/api/demo/photo',{...input,readyOcr:{reading:10010,attempt:{status:'detected',version:'fixture'}}}),/do not accept automatic/);
 await assert.rejects(act('/api/demo/midshift-reading',{...context,revision:0,row:{...row,closing:10010,readingConfirmed:true,readingMethod:'manual',photo_path:'/no-saved-photo'}}),/photo/);
 const photo=await act('/api/demo/photo',input);
 const pending=photo.report.midShiftPriceChanges[0];assert.equal(pending.readings[key],'');assert.equal(pending.readingPhotos[key].ocr_result,undefined);assert.equal(pending.readingPhotos[key].readingMethod,'manual');
 const typed={...context,revision:photo.readingRevision,row:{...row,closing:10010,readingConfirmed:true,readingMethod:'manual',photo_path:photo.photo_path}};
 for(const value of [Number(row.opening)-1,Number(row.opening)+21])await assert.rejects(act('/api/demo/midshift-reading',{...typed,row:{...typed.row,closing:value}}),/between opening/);
 const saved=await act('/api/demo/midshift-reading',typed),evidence=saved.report.midShiftPriceChanges[0].readingPhotos[key];
 assert.equal(evidence.readingConfirmed,true);assert.equal(evidence.readingMethod,'manual');assert.equal(evidence.ocr_result,undefined);assert.equal(evidence.ocr_detected_reading,null);
 assert.equal(state.audit.findLast(event=>event.action==='price-change-reading-saved').readingMethod,'manual');
 assert.deepEqual(saved.report.pumpRows,r.pumpRows);
 await assert.rejects(act('/api/demo/midshift-reading',typed),error=>error.status===409);
 await assert.rejects(act('/api/demo/photo',{reportKey:f.key,rowId:row.id,data:input.data,replaceReading:true,revision:0,readingMethod:'manual'}),/only available for mid-shift/);
 const closing=await act('/api/demo/photo',{reportKey:f.key,rowId:row.id,data:input.data,replaceReading:true,revision:0});
 assert.equal(closing.report.pumpRows[0].ocr_result.status,'pending','Ordinary pump photos still use OCR');
});
