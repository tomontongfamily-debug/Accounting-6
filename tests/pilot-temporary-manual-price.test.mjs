import test from 'node:test';
import assert from 'node:assert/strict';
import {bariliManualFixture} from './barili-manual-price-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {midShiftPumpKey,midShiftReadingComplete} from '../src/mid-shift-price-change.js';
import {BARILI_MANUAL_PRICE_GRANT as grant,BARILI_ROLLBACK_MANUAL_PRICE_GRANT as rollback,temporaryPriceGrant,temporaryManualPriceOpen,validTemporaryManualPriceReading} from '../src/temporary-price-reading.js';
import {compute} from '../src/accounting-engine.js';

const now=Date.parse('2026-11-10T17:10:00+08:00');
function body(f,row,reading=10010){return {reportKey:f.key,changeId:f.change.id,product:f.change.product,effectiveTime:f.change.effectiveTime,rowId:row.id,revision:f.state.reports[f.key].midShiftPriceChanges[0].readingPhotos[midShiftPumpKey(row)]?.readingRevision||0,reading};}

test('Nov 11 rollback permits all products only in today’s Shift 1, uses its own expiry, and preserves evidence after expiry',async t=>{
 const time=Date.parse('2026-11-11T08:45:00+08:00');t.mock.timers.enable({apis:['Date'],now:time});
 for(const product of ['Premium','Regular','Diesel']){
  const f=bariliManualFixture(product,rollback),row=f.rows[1];
  assert.equal(temporaryManualPriceOpen(f.report,f.change,time),true);assert.equal(temporaryPriceGrant(f.report,f.change).id,rollback.id);
  for(const mutation of [{date:'2026-11-12'},{shiftId:'shift-2'},{shiftId:'shift-3'},{branch:'Mabolo'},{confirmed:true},{baselineReport:true}])assert.equal(temporaryManualPriceOpen({...f.report,...mutation},f.change,time),false);
  for(const end of [Date.parse(rollback.startsAt)-1,Date.parse(rollback.expiresAt)])assert.equal(temporaryManualPriceOpen(f.report,f.change,end),false);
  const saved=await runAction(f.state,f.cashier,'/api/demo/temporary-price-reading',body(f,row)),change=saved.result.report.midShiftPriceChanges[0],evidence=change.readingPhotos[midShiftPumpKey(row)];
  assert.equal(evidence.manualEntry.authorizationId,rollback.id);assert.equal(validTemporaryManualPriceReading(saved.result.report,change,row,evidence),true);
  assert.equal(validTemporaryManualPriceReading({...saved.result.report,date:grant.date},change,row,evidence),false);
  assert.deepEqual(saved.result.report.pumpRows,f.report.pumpRows);
 }
});

test('existing Premium manual entries remain valid and new records cannot transfer between product changes or prices',async t=>{
 t.mock.timers.enable({apis:['Date'],now});
 const f=bariliManualFixture(),row=f.rows[0],key=midShiftPumpKey(row);
 const legacy={readingConfirmed:true,manualEntry:{authorizationId:grant.legacyId,recordedAt:new Date(now).toISOString(),role:'Cashier',rowId:row.id,pumpKey:key,value:10010}};
 assert.equal(validTemporaryManualPriceReading(f.report,f.change,row,legacy),true);
 assert.equal(validTemporaryManualPriceReading(f.report,{...f.change,id:'other'},row,legacy),false);
 for(const product of ['Regular','Diesel']){
  const target=bariliManualFixture(product),pump=target.rows[1];
  const saved=await runAction(target.state,target.cashier,'/api/demo/temporary-price-reading',body(target,pump));
  const change=saved.result.report.midShiftPriceChanges[0],evidence=change.readingPhotos[midShiftPumpKey(pump)];
  assert.equal(validTemporaryManualPriceReading(saved.result.report,change,pump,evidence),true);
  for(const mutation of [{id:'other'},{effectiveTime:'11:27'},{newPrice:95}])assert.equal(validTemporaryManualPriceReading(saved.result.report,{...change,...mutation},pump,evidence),false);
 }
});

test('temporary manual grant covers all products in the exact shift and closes on confirmation/submission or expiry',()=>{
 const f=bariliManualFixture();assert.equal(temporaryManualPriceOpen(f.report,f.change,now),true);
 for(const mutation of [{branch:'Mabolo'},{date:'2026-11-11'},{shiftId:'shift-2'},{baselineReport:true},{confirmed:true}])assert.equal(temporaryManualPriceOpen({...f.report,...mutation},f.change,now),false);
 for(const product of ['Premium','Regular','Diesel'])assert.equal(temporaryManualPriceOpen(f.report,{...f.change,id:product,product,newPrice:92},now),true);
 for(const mutation of [{id:''},{product:'Other'},{effectiveTime:'13:01'},{newPrice:0},{confirmedAt:'done'}])assert.equal(temporaryManualPriceOpen(f.report,{...f.change,...mutation},now),false);
 for(const time of [Date.parse(grant.startsAt)-1,Date.parse(grant.expiresAt)])assert.equal(temporaryManualPriceOpen(f.report,f.change,time),false);
});

test('cashier and manager save real manual evidence only for the authorized change, preserve photos and closing rows, then confirm and submit',async t=>{
 t.mock.timers.enable({apis:['Date'],now});
 const f=bariliManualFixture(),closing=structuredClone(f.report.pumpRows),original=structuredClone(f.change.readingPhotos[midShiftPumpKey(f.rows[0])]);
 async function act(role,route,input){const result=await runAction(f.state,role,route,input);f.state=result.state;return result.result;}
 // Incomplete evidence continues to block price confirmation.
 await assert.rejects(act(f.manager,'/api/demo/midshift-confirm',{reportKey:f.key,changeId:f.change.id}),/Photograph/);
 for(const [index,row] of f.rows.entries()){
  const saved=await act(index%2?f.cashier:f.manager,'/api/demo/temporary-price-reading',body(f,row));
  const change=saved.report.midShiftPriceChanges[0],evidence=change.readingPhotos[midShiftPumpKey(row)];
  assert.equal(evidence.manualEntry.authorizationId,grant.id);assert.equal(evidence.readingConfirmed,true);assert.equal(validTemporaryManualPriceReading(saved.report,change,row,evidence),true);assert.equal(midShiftReadingComplete(saved.report,change,row),true);
  if(index===0){assert.equal(evidence.photo_path,original.photo_path);assert.deepEqual(evidence.ocr_result,original.ocr_result);}
  else{assert.ok(!evidence.photo_path);assert.ok(!evidence.ocr_result);assert.ok(!evidence.ocr_detected_reading);}
  assert.deepEqual(saved.report.pumpRows,closing);
 }
 assert.equal(f.state.audit.filter(row=>row.action==='price-change-manual-reading-saved').length,6);
 const confirmed=await act(f.manager,'/api/demo/midshift-confirm',{reportKey:f.key,changeId:f.change.id});assert.ok(confirmed.report.midShiftPriceChanges[0].confirmedAt);
 await assert.rejects(act(f.cashier,'/api/demo/temporary-price-reading',body(f,f.rows[1])),error=>error.status===423);
 // Confirmed manual evidence remains valid after the temporary input window.
 t.mock.timers.setTime(Date.parse(grant.expiresAt)+1000);
 assert.equal(validTemporaryManualPriceReading(confirmed.report,confirmed.report.midShiftPriceChanges[0],f.rows[1],confirmed.report.midShiftPriceChanges[0].readingPhotos[midShiftPumpKey(f.rows[1])]),true);
 t.mock.timers.setTime(now);
 const expected=compute(f.state.reports[f.key]).expectedCash;assert.equal(expected,33588);
 await act(f.cashier,'/api/demo/cash-confirm',{report: f.state.reports[f.key],denominations:{1000:33,500:1,50:1,20:1,10:1,5:1,1:3}});
 await act(f.cashier,'/api/demo/cash-check',{report:f.state.reports[f.key]});
 const submitted=await act(f.cashier,'/api/reports/save',{report:f.state.reports[f.key],operation:'submit'});
 assert.equal(submitted.report.confirmed,true);assert.deepEqual(submitted.report.pumpRows,closing);
});

test('wrong station, role, change, nozzle, revision, bounds, expired grant and forged evidence cannot use the exception',async t=>{
 t.mock.timers.enable({apis:['Date'],now});const f=bariliManualFixture(),row=f.rows[1],input=body(f,row);
 const act=(role,body)=>runAction(f.state,role,'/api/demo/temporary-price-reading',body);
 await assert.rejects(act({role:'Admin',branch:''},input),error=>error.status===403);
 await assert.rejects(act({...f.cashier,branch:'Mabolo'},input),error=>error.status===403);
 for(const mutation of [{changeId:'other'},{revision:99},{rowId:f.report.pumpRows.find(row=>row.product==='Diesel').id},{reading:9999},{reading:10021},{reading:''},{reading:'NaN'}])await assert.rejects(act(f.cashier,{...input,...mutation}));
 const saved=await act(f.cashier,input);f.state=saved.state;
 await assert.rejects(act(f.cashier,input),error=>error.status===409);
 const evidence=saved.result.report.midShiftPriceChanges[0].readingPhotos[midShiftPumpKey(row)];
 await assert.rejects(runAction(f.state,f.cashier,'/api/demo/midshift-reading',{...input,revision:evidence.readingRevision,row:{...row,photo_path:'',closing:10010,readingConfirmed:true,manualEntry:evidence.manualEntry}}),/photo/);
 Object.assign(f.state.reports[f.key],{cashCountConfirmed:true,actualCashCounted:1000,cashDenominations:{1000:1}});
 await assert.rejects(runAction(f.state,f.cashier,'/api/demo/pump-reading',{reportKey:f.key,revision:row.readingRevision,row:{...row,photo_path:'',closing:10020,readingConfirmed:true,manualEntry:evidence.manualEntry}}),/photo/i);
 assert.equal(validTemporaryManualPriceReading(f.report,f.change,row,{readingConfirmed:true,manualEntry:{...evidence.manualEntry,value:99999}}),false);
 t.mock.timers.setTime(Date.parse(grant.expiresAt));await assert.rejects(act(f.cashier,body(f,f.rows[2])),error=>error.status===423);
});
