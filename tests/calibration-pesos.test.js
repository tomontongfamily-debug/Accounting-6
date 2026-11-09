import test from 'node:test';
import assert from 'node:assert/strict';
import {createReport,compute,normalizeReport} from '../src/accounting-engine.js';
import {calibrationAmount,calibrationPesoEntry,returnedCalibrationSummary,validateReturnedCalibration} from '../src/fuel-leak-loss.js';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';

function measured() {
  const report=createReport('Liloan','2026-11-06',{Premium:89.30,Regular:88.30,Diesel:95.70},'shift-1');
  report.pumpRows.forEach(row=>Object.assign(row,{opening:10000,closing:10000,closingEntered:true}));
  for(const [product,liters] of [['Premium',220.94],['Regular',508],['Diesel',143.03]])report.pumpRows.find(row=>row.product===product).closing+=liters;
  report.purchaseRows=[{id:'office',amount:25000},{id:'coke',amount:70}];
  report.deductions={gcash:7233,posRedemption:1500};report.actualCashCounted=43676;
  return report;
}

test('Liloan correction treats 564.24 as pesos once and yields a 231.07 shortage',()=>{
  const report=measured(),index=report.tankRows.findIndex(row=>row.product==='Regular');
  const before=compute(report);assert.equal(before.cashVariance,-795.31);
  report.tankRows[index]=calibrationPesoEntry(report.tankRows[index],'564.24');
  const result=compute(report),summary=returnedCalibrationSummary(report).find(row=>row.product==='Regular');
  assert.equal(validateReturnedCalibration(report),'');
  assert.ok(Math.abs(result.expectedCash-43907.073)<0.000001);
  assert.equal(result.cashVariance,-231.07);assert.equal(result.actualCashCounted,43676);
  assert.equal(result.deductionTotal,33803);assert.equal(summary.salesAdjustment,564.24);
  assert.ok(Math.abs(before.expectedCash-result.expectedCash-564.24)<0.000001);
  assert.ok(Math.abs(summary.calibrationLiters-564.24/88.30)<0.000001);
  const normalized=normalizeReport(report,report.branch,report.date,report.shiftId,report.prices);
  assert.equal(normalized.tankRows[index].calibrationUnit,'PHP');assert.equal(compute(normalized).cashVariance,-231.07);
});

test('historical litre entries keep their meaning and are never silently converted',()=>{
  const report=measured(),index=report.tankRows.findIndex(row=>row.product==='Regular');
  report.tankRows[index].calibration=5;const original=structuredClone(report),before=compute(report);
  assert.ok(Math.abs(calibrationAmount(report,report.tankRows[index])-441.50)<0.000001);
  report.tankRows[index]=calibrationPesoEntry(report.tankRows[index],'441.50');
  assert.ok(Math.abs(compute(report).expectedCash-before.expectedCash)<0.000001);
  assert.equal(original.tankRows[index].calibration,5);assert.equal(original.tankRows[index].calibrationUnit,undefined);
});

test('peso adjustment remains exact across a mid-shift price change and excludes fuel only once',()=>{
  const report=measured(),pump=report.pumpRows.find(row=>row.product==='Regular');
  report.midShiftBasePrices={...report.prices};report.midShiftPriceChanges=[{id:'price',product:'Regular',effectiveTime:'09:00',newPrice:90,readings:{[pump.id]:10254}}];
  const before=compute(report);report.tankRows[1]=calibrationPesoEntry(report.tankRows[1],564.24);
  assert.equal(validateReturnedCalibration(report),'');assert.ok(Math.abs(before.expectedCash-compute(report).expectedCash-564.24)<0.000001);
  assert.equal(returnedCalibrationSummary(report)[1].salesAdjustment,564.24);
});

test('peso calibration rejects invalid amounts, missing volume, and totals exceeding sales after metered leaks',()=>{
  const report=measured(),tank=report.tankRows.find(row=>row.product==='Regular');tank.calibrationUnit='PHP';
  for(const value of [-1,'invalid',Infinity]){tank.calibration=value;assert.match(validateReturnedCalibration(report),/non-negative/);}
  tank.calibration=1.001;assert.match(validateReturnedCalibration(report),/two decimal/);
  tank.calibration=44856.40;assert.equal(validateReturnedCalibration(report),'');
  report.tankRows.push({...tank,id:'other',calibration:.01});assert.match(validateReturnedCalibration(report),/cannot exceed/);report.tankRows.pop();
  const pump=report.pumpRows.find(row=>row.product==='Regular');report.fuelLeakLosses=[{id:'leak',product:'Regular',pumpRowId:pump.id,liters:1}];
  assert.match(validateReturnedCalibration(report),/cannot exceed/);
  report.fuelLeakLosses=[];pump.closing=pump.opening;assert.match(validateReturnedCalibration(report),/completed pump readings/);
  tank.calibration=0;assert.equal(validateReturnedCalibration(report),'');
  tank.calibrationUnit='USD';assert.match(validateReturnedCalibration(report),/invalid calibration unit/);
});

test('cashier API persists explicit pesos, protects the cash count, and rejects an excessive amount',async()=>{
  let {state,report,cashier,key}=fixture();
  report.pumpRows.forEach(row=>Object.assign(row,{closing:row.opening,closingEntered:true}));
  report.pumpRows.find(row=>row.product==='Regular').closing+=508;
  report.actualCashCounted=1000;report.cashCountConfirmed=true;report.cashDenominations={1000:1};state.reports[key]=report;
  const changed=structuredClone(report);changed.tankRows[1]=calibrationPesoEntry(changed.tankRows[1],'564.24');
  const out=await runAction(state,cashier,'/api/reports/save',{report:changed,operation:'draft'});state=out.state;
  assert.equal(state.reports[key].tankRows[1].calibrationUnit,'PHP');assert.equal(Number(state.reports[key].tankRows[1].calibration),564.24);
  assert.equal(state.reports[key].actualCashCounted,1000);
  const invalid=structuredClone(state.reports[key]);invalid.tankRows[1].calibration=999999;
  await assert.rejects(runAction(state,cashier,'/api/reports/save',{report:invalid,operation:'draft'}),/cannot exceed/);
});
