import test from 'node:test';
import assert from 'node:assert/strict';
import { runAction } from '../pilot/service.mjs';
import { fixture } from './pilot-fixture.mjs';
import { compute } from '../src/accounting-engine.js';

test('Roles, station scope, stale desktop drafts and nozzle revisions',async()=>{
  let {state,report,key,cashier,manager}=fixture();
  await assert.rejects(runAction(state,{role:'Cashier',branch:'Mabolo'},'/api/store/load'),/another station/);
  await assert.rejects(runAction(state,manager,'/api/demo/pump-report',{reportKey:key}),/role/);
  const photo='/api/pilot/photo?id=fixture';const row=report.pumpRows[0];state.photos[photo]={branch:'Liloan',reportKey:key,rowId:row.id};
  const payload={reportKey:key,revision:0,row:{...row,closing:Number(row.opening)+10,closingEntered:true,readingConfirmed:true,photo_path:photo}};
  const saved=await runAction(state,cashier,'/api/demo/pump-reading',payload);state=saved.state;
  assert.equal(saved.result.report.pumpRows[0].readingRevision,1);
  await assert.rejects(runAction(state,cashier,'/api/demo/pump-reading',payload),/another device/);
  const merged=await runAction(state,cashier,'/api/reports/save',{report});
  assert.equal(merged.result.report.pumpRows[0].photo_path,photo);
  assert.equal(merged.result.report.pumpRows[0].closing,Number(row.opening)+10);
  await assert.rejects(runAction(merged.state,cashier,'/api/reports/save',{report}),/another device/);
  const desktop=await runAction(state,cashier,'/api/demo/pump-report',{reportKey:key});
  assert.equal(desktop.result.report.pumpRows[0].photo_path,photo);
  await assert.rejects(runAction(state,cashier,'/api/reports/save',{report:desktop.result.report,operation:'submit'}),/reconciliation|cash/);
});

test('Phone readings do not block the desktop cash count or overwrite saved nozzle evidence',async()=>{
 let {state,report,key,cashier}=fixture();
 const desktop=structuredClone(report);
 for(const row of report.pumpRows.slice(0,2)){
  const photo='/api/pilot/photo?id=cash-test-'+row.id;state.photos[photo]={branch:'Liloan',reportKey:key,rowId:row.id};
  const out=await runAction(state,cashier,'/api/demo/pump-reading',{reportKey:key,revision:0,row:{...row,photo_path:photo,closing:Number(row.opening)+79.41,closingEntered:true,readingConfirmed:true}});state=out.state;
 }
 const before=structuredClone(state.reports[key].pumpRows);
 const cash=await runAction(state,cashier,'/api/demo/cash-confirm',{report:desktop,denominations:{1000:81,500:12,100:2,5:9}});
 assert.equal(cash.result.report.actualCashCounted,87245);
 assert.equal(cash.result.report.cashCountConfirmed,true);
 assert.deepEqual(cash.result.report.pumpRows,before);
 await assert.rejects(runAction(cash.state,cashier,'/api/demo/cash-confirm',{report:desktop,denominations:{100:1}}),/another device/);
});

test('Photo merge never crosses another desktop edit, manager price edit, or unknown legacy revision',async()=>{
 const {state,report,key,cashier,manager}=fixture();
 const changed=await runAction(state,cashier,'/api/reports/save',{report:{...report,notes:'Saved on another PC'}});
 await assert.rejects(runAction(changed.state,cashier,'/api/demo/cash-confirm',{report,denominations:{100:2}}),/another device/);
 const priced=await runAction(state,manager,'/api/reports/save',{report:{...report,midShiftPriceChanges:[{id:'new',product:'Diesel',effectiveTime:'09:00',newPrice:61}]}});
 await assert.rejects(runAction(priced.state,cashier,'/api/demo/cash-confirm',{report,denominations:{100:2}}),/another device/);
 const legacy=structuredClone(state);legacy.reports[key].pilotRevision=10;
 await assert.rejects(runAction(legacy,cashier,'/api/demo/cash-confirm',{report,denominations:{100:2}}),/another device/);
});
test('Cash denominations, mandatory all-nozzle photos, submission lock, deposit reservation',async()=>{
  let {state,report,key,cashier,manager,approver,admin}=fixture();
  const act=async(role,route,input)=>{const outcome=await runAction(state,role,route,input);state=outcome.state;return outcome.result;};
  await assert.rejects(act(cashier,'/api/demo/cash-confirm',{report,denominations:{200:1.5}}),/whole numbers/);
  report=(await act(cashier,'/api/demo/cash-confirm',{report,denominations:{1000:1,500:1,200:1}})).report;
  assert.equal(report.actualCashCounted,1700);
  await assert.rejects(act(cashier,'/api/demo/cash-check',{report}),/all readings/);
  for(const row of report.pumpRows) {
    const photo='/api/pilot/photo?id='+row.id;state.photos[photo]={branch:'Liloan',reportKey:key,rowId:row.id};
    report=(await act(cashier,'/api/demo/pump-reading',{reportKey:key,revision:0,row:{...row,closing:Number(row.opening)+10,closingEntered:true,readingConfirmed:true,photo_path:photo}})).report;
  }
  report=(await act(cashier,'/api/demo/cash-check',{report})).report;
  assert.equal(report.cashReviewState,'recount');
  report=(await act(cashier,'/api/demo/cash-recount',{report,denominations:{1000:1,200:2}})).report;
  report=(await act(cashier,'/api/reports/save',{report:{...report,actualCashCounted:999999},operation:'submit'})).report;
  assert.equal(report.actualCashCounted,1400);assert.equal(report.confirmed,true);
  await assert.rejects(act(cashier,'/api/reports/save',{report}),/locked/);
  const available=await act(manager,'/api/demo/deposits',{branch:'Liloan',date:'2026-09-24'});
  assert.equal(available.coverage.reports.length,1);assert.equal(available.coverage.reports[0].key,key);
  const input={branch:'Liloan',depositDate:'2026-09-24',bank:'Test bank',reference:'TEST-ONLY-1',amount:1400,coveredReportKeys:[key],carryoverSourceIds:[],reviewedCoveredCash:1400,reviewedCarryover:0};
  const deposit=(await act(manager,'/api/demo/deposit-submit',input)).deposit;
  await assert.rejects(act(manager,'/api/demo/deposit-submit',{...input,reference:'TEST-ONLY-2'}),/no longer available/);
  await assert.rejects(act(admin,'/api/demo/deposit-verify',{id:deposit.id,action:'confirm'}),/role/);
  await act(approver,'/api/demo/deposit-verify',{id:deposit.id,action:'confirm'});
  assert.equal(state.deposits[0].status,'verified');
  const snapshot=structuredClone(state.reports[key]);state.pay=[{id:'late',branch:'Liloan',date:report.date,shiftId:report.shiftId,amount:500,status:'PAID'}];
  const loaded=await act(admin,'/api/store/load',{});
  assert.equal(compute(loaded.reportRows.find(r=>r.report_key===key).data).expectedCash,compute(snapshot).expectedCash);
});
test('Forged prices, final status and imports are ignored; historical changes prohibited',async()=>{
  const {state,report,key,cashier}=fixture();
  const saved=await runAction(state,cashier,'/api/reports/save',{report:{...report,prices:{Diesel:1},confirmed:true,checkRequired:false,poRows:[{amount:999}],purchaseRows:[{amount:999}],oilSales:5}});
  assert.equal(saved.state.reports[key].confirmed,false);assert.equal(saved.state.reports[key].prices.Diesel,60);assert.equal(saved.state.reports[key].purchaseRows.length,0);
  await assert.rejects(runAction(state,{role:'Admin'},'/api/reports/save',{report:Object.values(state.reports)[0]}),/Historical/);
});

test('Manager phone price photos keep their context and require all affected nozzles',async()=>{
  let {state,report,key,manager,cashier}=fixture();
  const act=async(role,route,input)=>{const out=await runAction(state,role,route,input);state=out.state;return out.result;};
  let change={id:'price-test',product:'Diesel',effectiveTime:'09:00',newPrice:61};
  report=(await act(manager,'/api/reports/save',{report:{...report,midShiftPriceChanges:[change]}})).report;
  change=report.midShiftPriceChanges[0];
  await assert.rejects(act(manager,'/api/reports/save',{report:{...report,midShiftPriceChanges:[{...change,confirmedAt:'request'}]}}),/Photograph/);
  for(const row of report.pumpRows.filter(r=>r.product==='Diesel')) {
    const path='/api/pilot/photo?id='+row.id;state.photos[path]={reportKey:key,rowId:row.id,branch:'Liloan',changeId:change.id,product:change.product,effectiveTime:change.effectiveTime};
    const input={reportKey:key,changeId:change.id,product:change.product,effectiveTime:change.effectiveTime,revision:0,row:{...row,photo_path:path,closing:Number(row.opening)+5,readingConfirmed:true}};
    await assert.rejects(act(cashier,'/api/demo/midshift-reading',input),/role/);
    report=(await act(manager,'/api/demo/midshift-reading',input)).report;
    await assert.rejects(act(manager,'/api/demo/midshift-reading',input),/another device/);
  }
  change=report.midShiftPriceChanges[0];
  report=(await act(manager,'/api/reports/save',{report:{...report,midShiftPriceChanges:[{...change,confirmedAt:'request'}]}})).report;
  assert.ok(report.midShiftPriceChanges[0].confirmedAt);
  report=(await act(manager,'/api/reports/save',{report:{...report,midShiftPriceChanges:[{...report.midShiftPriceChanges[0],effectiveTime:'10:00',confirmedAt:''}]}})).report;
  assert.deepEqual(report.midShiftPriceChanges[0].readingPhotos,{});
  assert.equal(report.pumpRows.some(r=>r.photo_path),false);
});
