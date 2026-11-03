import test from 'node:test';
import assert from 'node:assert/strict';
import { createReport, compute, reportKey } from '../src/accounting-engine.js';
import { accountingCashVouchers, accountingFuelVouchers } from '../pilot/cv-allocations.mjs';
import { managerReconciliationAdjustments, managerReconciliationIssues } from '../src/manager-reconciliation.js';
import { refreshFuelCVReview } from '../src/cv-fuel-issues.js';
const report=shiftId=>createReport('Liloan','2026-11-03',{Premium:90,Regular:89,Diesel:100},shiftId);
test('cash allocations conserve one source voucher across two reports',()=>{
 const a=report('shift-1'),b=report('shift-2');
 const event={id:'source',sourceVoucherId:'source',branch:'Liloan',date:'2026-11-03',shiftId:'shift-2',category:'OPEX',item:'Salary',amount:10000,status:'APPROVED',fundingSource:'STATION_CASH',fundingAllocations:[{date:a.date,shiftId:a.shiftId,amount:6000},{date:b.date,shiftId:b.shiftId,amount:4000}]};
 const state={startDate:'2026-10-03',reports:{[reportKey(a.branch,a.date,a.shiftId)]:a,[reportKey(b.branch,b.date,b.shiftId)]:b},cvCashEvents:[event]};
 assert.equal(accountingCashVouchers(state,a)[0].amount,6000);assert.equal(accountingCashVouchers(state,b)[0].amount,4000);
 event.fundingAllocations[1].amount=4001;assert.throws(()=>accountingCashVouchers(state,a),/source total/);
});
test('fuel issued through a pump reduces cash sales without reducing tank stock twice',()=>{
 const a=report('shift-1');a.pumpRows.forEach(p=>{p.opening=100;p.closing=100;p.closingEntered=true;});
 const p=a.pumpRows.find(p=>p.product==='Diesel');p.closing=200;
 a.tankRows.forEach(t=>{t.opening=1000;t.actualDip=1000;});a.actualCashCounted=9000;
 const original=compute(a);a.cvFuelRows=[{sourceVoucherId:'fuel',product:'Diesel',amount:1000,liters:10}];
 const after=compute(a);assert.equal(original.fuelSales-after.fuelSales,1000);assert.equal(after.purchaseTotal,0);assert.equal(after.expectedCash,9000);assert.equal(after.cashVariance,0);
 assert.equal(after.tankRows.find(t=>t.product==='Diesel').expectedDip,original.tankRows.find(t=>t.product==='Diesel').expectedDip);
 assert.equal(after.fuelLiters.Diesel,90);
 a.cvFuelRows.push(a.cvFuelRows[0]);assert.throws(()=>compute(a),/duplicate/);
});
test('fuel sources never become cash purchase rows',()=>{
 const a=report('shift-1'),s={startDate:'2026-10-03',reports:{[reportKey(a.branch,a.date,a.shiftId)]:a},cvCashEvents:[{id:'f',sourceVoucherId:'f',branch:a.branch,date:a.date,shiftId:a.shiftId,amount:100,liters:1,fuelType:'Diesel',fundingSource:'STATION_FUEL',status:'APPROVED',category:'Personal',item:'Fuel'}]};
 assert.deepEqual(accountingCashVouchers(s,a),[]);assert.equal(accountingFuelVouchers(s,a)[0].liters,1);
});
test('October owner correction reconciles only once and still flags unmatched CVs',()=>{
 const a=createReport('Liloan','2026-10-19',{Premium:90,Regular:89,Diesel:100},'shift-1');
 a.managerReconciliation={version:1,approvedBy:'Owner',approvedAt:'2026-11-03T00:00:00Z',sourceSha256:'a'.repeat(64),grossFuelSales:108588.32,calibrationCash:0,cashVoucherTotal:840,otherCashOutlays:0,cashCount:107023};
 a.actualCashCounted=107023;a.deductions={gcash:450,posRedemption:157};a.purchaseRows=[{amount:70708.54}];
 const first=compute(a);assert.equal(first.cashVariance,-118.32);assert.equal(first.purchaseTotal,840);assert.equal(managerReconciliationIssues(a)[0].category,'MANUAL_DEDUCTION');
 a.purchaseRows=[{amount:840}];const matched=compute(a);assert.equal(matched.cashVariance,-118.32);assert.equal(matched.reconciliationCVAdjustment,0);assert.equal(managerReconciliationIssues(a).length,0);
 assert.equal(managerReconciliationAdjustments({...a,date:'2026-11-03'},840,0).sales,0);
});

test('fuel allocated beyond metered sales remains a visible review issue',()=>{
 const a=report('shift-1');a.pumpRows.forEach(p=>{p.opening=100;p.closing=100;p.closingEntered=true;});
 a.cvFuelRows=[{sourceVoucherId:'fuel',product:'Diesel',amount:100,liters:1}];a.confirmed=true;
 const r=refreshFuelCVReview(a,compute(a));assert.equal(r.checkRequired,true);assert.equal(r.checkDetails[0].category,'MANUAL_DEDUCTION');
 a.cvFuelRows=[];assert.equal(refreshFuelCVReview({...r,cvFuelRows:[]},compute(a)).checkRequired,false);
});
