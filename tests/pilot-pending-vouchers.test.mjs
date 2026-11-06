import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSources} from '../pilot/integrations.mjs';
import {reconcileSources} from '../pilot/state.mjs';
import {runAction} from '../pilot/service.mjs';
import {compute} from '../src/accounting-engine.js';
import {pendingVouchersForReport} from '../src/pending-vouchers.js';
import {fixture} from './pilot-fixture.mjs';
const cv={id:'pending-one',ref:'SCV-TEST-1',station:'liloan',payment_method:'cash',status:'pending',amount:1000,created_at:'2026-09-23T15:00:00+08:00',purpose:'Payout',category:{name:'OPEX'},funding_allocations:[{date:'2026-09-23',shiftId:'shift-1',amount:600},{date:'2026-09-23',shiftId:'shift-2',amount:400}]};

test('pending split CV follows funding shifts and never changes counted cash or deductions; approval imports once and clears the notice',async()=>{
 const f=fixture();f.report.actualCashCounted=2000;f.report.confirmed=true;f.report.cashCountConfirmed=true;
 f.state.reports[f.key]=structuredClone(f.report);
 const before=compute(f.report);
 reconcileSources(f.state,normalizeSources({cv:[cv]},f.state.startDate));
 assert.equal(compute(f.state.reports[f.key]).expectedCash,before.expectedCash);
 assert.equal(f.state.cvCashEvents.length,0);
 let exposed=await runAction(f.state,f.cashier,'/api/demo/cv-status',{reportKey:f.key});
 assert.equal(exposed.changed,false);
 assert.equal(exposed.result.report.pendingVouchers.cashTotal,600);
 assert.equal(exposed.result.report.pendingVouchers.rows[0].totalAmount,1000);
 assert.equal(exposed.result.report.pendingVouchers.rows[0].shiftId,'shift-1');
 f.state.reports['Liloan__2026-09-23__shift-2']={...structuredClone(f.report),shiftId:'shift-2'};
 assert.equal(pendingVouchersForReport(f.state,f.state.reports['Liloan__2026-09-23__shift-2']).cashTotal,400);
 const approved=normalizeSources({cv:[{...cv,status:'approved'}]},f.state.startDate);
 reconcileSources(f.state,approved);reconcileSources(f.state,structuredClone(approved));
 exposed=await runAction(f.state,f.cashier,'/api/demo/cv-status',{reportKey:f.key});
 assert.equal(exposed.result.report.pendingVouchers.rows.length,0);
 assert.equal(exposed.result.report.purchaseRows.length,1);
 assert.equal(exposed.result.report.actualCashCounted,2000);
 assert.equal(compute(exposed.result.report).deductionTotal-before.deductionTotal,600);
});

test('cash and fuel pending totals remain separate; cancelled, online and other station CVs do not appear',()=>{
 const f=fixture();
 const inputs=[cv,{...cv,id:'fuel',ref:'SCV-FUEL',payment_method:'fuel',amount:200,funding_allocations:[{date:f.report.date,shiftId:f.report.shiftId,amount:200}]},{...cv,id:'cancelled',status:'cancelled'},{...cv,id:'online',payment_method:'online'},{...cv,id:'other',station:'pondol'}];
 reconcileSources(f.state,normalizeSources({cv:inputs},f.state.startDate));
 const notice=pendingVouchersForReport(f.state,f.report);
 assert.equal(notice.cashTotal,600);assert.equal(notice.fuelTotal,200);assert.equal(notice.rows.length,2);
 assert.equal(f.state.cvCashEvents.length,0);
 assert.equal(pendingVouchersForReport(f.state,{...f.report,branch:'Pondol'}).rows.length,0);
 assert.equal(pendingVouchersForReport(f.state,{...f.report,date:'2026-09-24'}).rows.length,0);
 assert.equal(pendingVouchersForReport(f.state,{...f.report,baselineReport:true}).rows.length,0);
});

test('malformed pending allocation is visible for funding review without creating a deduction or app check',async()=>{
 const f=fixture();reconcileSources(f.state,normalizeSources({cv:[{...cv,funding_allocations:[{date:f.report.date,shiftId:f.report.shiftId,amount:900}]}]},f.state.startDate));
 const r=(await runAction(f.state,f.cashier,'/api/demo/cv-status',{reportKey:f.key})).result.report;
 assert.equal(r.pendingVouchers.rows.length,0);assert.equal(r.pendingVouchers.unassigned[0].reference,cv.ref);
 assert.equal(r.purchaseRows.length,0);assert.equal(compute(r).deductionTotal,0);
 await assert.rejects(runAction(f.state,{role:'Cashier',branch:'Pondol'},'/api/demo/cv-status',{reportKey:f.key}),/another station/);
 const unavailable=pendingVouchersForReport({...f.state,cvPendingVouchers:undefined},f.report);assert.equal(unavailable.status,'unavailable');
});
