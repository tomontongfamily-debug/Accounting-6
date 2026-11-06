import test from 'node:test';
import assert from 'node:assert/strict';
import {compute,createReport} from '../src/accounting-engine.js';
import {returnedCalibrationSummary,validateReturnedCalibration,validateFuelLeakLosses} from '../src/fuel-leak-loss.js';
import {reviewReasons,reviewIssuePresentation} from '../src/accounting-review.js';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';

function measuredReport() {
 const report=createReport('Liloan','2026-11-06',{Premium:80,Regular:88.30,Diesel:70},'shift-1');
 report.pumpRows.forEach(row=>Object.assign(row,{opening:10000,closing:10000,closingEntered:true}));
 report.pumpRows.find(row=>row.product==='Regular').closing+=508;
 return report;
}
test('564.24 L calibration against 508 L metered is rejected without changing saved evidence',()=>{
 const report=measuredReport();report.tankRows.find(row=>row.product==='Regular').calibration='564.24';
 const before=structuredClone(report);
 assert.match(validateReturnedCalibration(report),/564.24 L.*508.00 L.*not pesos/);
 assert.match(validateFuelLeakLosses(report),/cannot exceed/);
 assert.deepEqual(report,before);
});
test('valid calibration shows the same monetary adjustment as the financial engine, including a price change',()=>{
 const report=measuredReport(),pump=report.pumpRows.find(row=>row.product==='Regular');
 report.midShiftBasePrices={...report.prices};report.midShiftPriceChanges=[{id:'price',product:'Regular',effectiveTime:'09:00',newPrice:90,readings:{[pump.id]:10254}}];
 const before=compute(report);report.tankRows.find(row=>row.product==='Regular').calibration=5;
 assert.equal(validateReturnedCalibration(report),'');
 const summary=returnedCalibrationSummary(report).find(row=>row.product==='Regular');
 assert.ok(Math.abs(summary.salesAdjustment-(before.expectedCash-compute(report).expectedCash))<0.000001);
 assert.equal(summary.meteredLiters,508);
});
test('calibration cap applies to the product total and also accounts for metered leaks',()=>{
 const report=measuredReport(),tank=report.tankRows.find(row=>row.product==='Regular'),pump=report.pumpRows.find(row=>row.product==='Regular');
 tank.calibration=250;report.tankRows.push({...tank,id:'other',calibration:259});
 assert.match(validateReturnedCalibration(report),/cannot exceed/);
 report.tankRows.pop();tank.calibration=508;
 assert.equal(validateReturnedCalibration(report),'');
 report.fuelLeakLosses=[{id:'loss',product:'Regular',pumpRowId:pump.id,liters:1}];
 assert.match(validateReturnedCalibration(report),/Calibration and metered leak loss/);
 for(const value of [-1,'bad',Infinity]){tank.calibration=value;assert.match(validateReturnedCalibration(report),/non-negative/);}
});
test('server rejects invalid calibration in a direct draft or submission request',async()=>{
 const {state,report,cashier}=fixture();
 report.pumpRows.forEach(row=>Object.assign(row,{closing:row.opening,closingEntered:true}));
 report.pumpRows.find(row=>row.product==='Regular').closing+=508;
 report.tankRows.find(row=>row.product==='Regular').calibration=564.24;
 const before=structuredClone(state);
 for(const operation of ['draft','submit'])await assert.rejects(runAction(state,cashier,'/api/reports/save',{report,operation}),/returned calibration.*cannot exceed/);
 assert.deepEqual(state,before);
});
test('review labels separate POS, deposits and historical reconciliation without clearing flags',()=>{
 const report=measuredReport();Object.assign(report,{confirmed:true,checkRequired:true,checkCategories:['REDEMPTION','BANK_DEPOSIT'],checkDetails:[{category:'REDEMPTION',detail:'Invalid points transaction'},{category:'BANK_DEPOSIT',detail:'Receipt covers different shifts'},{category:'MANUAL_DEDUCTION',source:'Manager reconciliation',detail:'Linked amount differs'}]});
 const before=structuredClone(report),reasons=reviewReasons(report),shown=reasons.map(reviewIssuePresentation);
 assert.match(shown[0].label,/POS points/);assert.match(shown[0].action,/POS points/);
 assert.equal(shown[1].label,'Deposit allocation review');assert.match(shown[1].action,/selected source shifts/);
 assert.match(shown[2].label,/Historical reconciliation/);assert.match(shown[2].action,/CV reference/);
 assert.deepEqual(report,before);
});
test('legacy invalid calibration is explained in read-only report review while totals and originals remain intact',()=>{
 const report=measuredReport();report.confirmed=true;report.tankRows[1].calibration=564.24;
 const before=compute(report),original=structuredClone(report);
 assert.ok(reviewReasons(report).some(issue=>issue.category==='CALIBRATION'));
 assert.deepEqual(compute(report),before);assert.deepEqual(report,original);
});
