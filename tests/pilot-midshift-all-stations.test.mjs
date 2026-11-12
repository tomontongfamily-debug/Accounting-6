import test from 'node:test';
import assert from 'node:assert/strict';
import {createReport,reportKey} from '../src/accounting-engine.js';
import {initialState} from '../pilot/state.mjs';
import {runAction} from '../pilot/service.mjs';
import {ALL_STATIONS} from '../src/station-rollout.js';
import {midShiftPumpKey,midShiftReadingComplete} from '../src/mid-shift-price-change.js';

for(const branch of ALL_STATIONS)test(`${branch}: all price-change products and pumps save independently without changing closing readings`,async()=>{
  const prices={Premium:70,Regular:65,Diesel:60};
  const previous=createReport(branch,'2026-11-11',prices,'shift-3');
  Object.assign(previous,{confirmed:true,baselineConfirmed:true});
  previous.pumpRows=previous.pumpRows.map(row=>({...row,opening:10000,closing:10000,closingEntered:true,setupRequired:false}));
  const report=createReport(branch,'2026-11-12',prices,'shift-1');
  Object.assign(report,{baselineConfirmed:true,cashierName:'Isolated test'});
  report.pumpRows=report.pumpRows.map(row=>({...row,opening:10000,closing:10020,closingEntered:true,readingConfirmed:true,photo_path:'original-closing',setupRequired:false}));
  report.midShiftPriceChanges=['Premium','Regular','Diesel'].map(product=>({id:product,product,effectiveTime:'11:00',newPrice:71,readings:{},readingPhotos:{},photoRequired:true}));
  let state=initialState([],[],{mode:'shadow',start_date:'2026-11-06'});
  state.branches=ALL_STATIONS;state.priceBook[branch]={'2026-11-11':prices};
  state.reports=Object.fromEntries([previous,report].map(data=>[reportKey(data.branch,data.date,data.shiftId),structuredClone(data)]));
  const key=reportKey(branch,report.date,report.shiftId),closing=structuredClone(state.reports[key].pumpRows);
  const act=async(role,route,input)=>{const out=await runAction(state,{role,branch},route,input,{uploadPhoto:async()=>{}});state=out.state;return out.result;};
  for(const change of report.midShiftPriceChanges){
    const rows=report.pumpRows.filter(row=>row.product===change.product);
    for(const row of rows){
      const context={reportKey:key,changeId:change.id,product:change.product,effectiveTime:change.effectiveTime};
      const photo=await act('Cashier','/api/demo/photo',{...context,rowId:row.id,pumpKey:midShiftPumpKey(row),replaceReading:true,readingMethod:'manual',revision:0,data:'data:image/jpeg;base64,/9j/2Q=='});
      const pending=photo.report.midShiftPriceChanges.find(item=>item.id===change.id).readingPhotos[midShiftPumpKey(row)];
      assert.equal(pending.readingMethod,'manual');assert.equal(pending.ocr_result,undefined);assert.equal(pending.ocr_detected_reading,null);
      await act('Cashier','/api/demo/midshift-reading',{...context,revision:photo.readingRevision,row:{...row,closing:10010.12,photo_path:photo.photo_path,readingConfirmed:true}});
    }
    const saved=state.reports[key].midShiftPriceChanges.find(item=>item.id===change.id);
    assert.equal(Object.keys(saved.readingPhotos).length,rows.length);
    assert.ok(rows.every(row=>midShiftReadingComplete(state.reports[key],saved,row)));
    assert.ok(Object.values(saved.readingPhotos).every(photo=>photo.readingMethod==='manual'&&!photo.ocr_result));
    assert.equal(new Set(Object.values(saved.readingPhotos).map(photo=>photo.photo_path)).size,rows.length);
    await act('Manager','/api/demo/midshift-confirm',{reportKey:key,changeId:change.id});
  }
  assert.deepEqual(state.reports[key].pumpRows,closing);
  assert.ok(state.reports[key].midShiftPriceChanges.every(change=>change.confirmedAt));
});
