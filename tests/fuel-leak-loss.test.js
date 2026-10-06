import test from 'node:test';
import assert from 'node:assert/strict';
import {compute, createReport, normalizeReport} from '../src/accounting-engine.js';
import {pumpLeakLiters, pumpSaleLiters, pumpSalesBreakdown, validateFuelLeakLosses} from '../src/fuel-leak-loss.js';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);
function reportWithLoss(liters = 2.38, metered = true) {
  const report = createReport('Liloan', '2026-10-05', {Premium: 89.8, Regular: 88.8, Diesel: 104.95}, 'shift-1');
  report.pumpRows = report.pumpRows.map(row => ({...row, opening: 10000, closing: 10000, closingEntered: true}));
  const pump = report.pumpRows.find(row => row.pump === 'Pump 1' && row.nozzle === 'Regular2');
  pump.closing += 2.38;
  report.tankRows = report.tankRows.map(row => ({...row, opening: 1000, actualDip: row.product === 'Regular' ? 997.62 : 1000}));
  report.confirmed = true;
  report.fuelLeakLosses = [{id: 'loss-reference', product: 'Regular', pumpRowId: metered ? pump.id : '', liters, notes: 'Manager reported fuel leakage.'}];
  return {report, pump};
}

test('Metered leak reclassifies exactly 2.38 L and 211.344 pesos without deducting tank outflow twice', () => {
  const {report, pump} = reportWithLoss();
  const original = structuredClone(report); original.fuelLeakLosses = [];
  const before = compute(original), after = compute(report);
  close(pumpSaleLiters(report, pump), 0);
  close(pumpLeakLiters(report, pump), 2.38);
  close(after.fuelLiters.Regular, 0);
  close(after.fuelLeakLossLiters, 2.38);
  close(after.fuelLeakLossSales, 211.344);
  close(before.expectedCash - after.expectedCash, 211.344);
  close(after.tankOutflowLiters.Regular, before.fuelLiters.Regular);
  close(after.tankRows[1].expectedDip, before.tankRows[1].expectedDip);
  close(after.tankRows[1].variance, before.tankRows[1].variance);
  assert.deepEqual(report.pumpRows, original.pumpRows);
  assert.deepEqual(report.tankRows, original.tankRows);
});

test('Loss outside the pump meter explains tank variance without changing paid sales or expected cash', () => {
  const {report} = reportWithLoss(5, false);
  report.tankRows[1].actualDip -= 5;
  const original = structuredClone(report); original.fuelLeakLosses = [];
  const before = compute(original), after = compute(report);
  close(after.expectedCash, before.expectedCash);
  close(after.fuelLiters.Regular, before.fuelLiters.Regular);
  close(after.tankRows[1].unadjustedVariance, -5);
  close(after.tankRows[1].variance, 0);
  close(after.tankRows[1].expectedDip, before.tankRows[1].expectedDip - 5);
});

test('Partial loss leaves actual paid sales and other products intact', () => {
  const {report} = reportWithLoss(1);
  const after = compute(report);
  close(after.fuelLiters.Regular, 1.38);
  close(after.fuelSalesByProduct.Regular, 1.38 * 88.8);
  close(after.fuelLiters.Premium, 0);
  close(after.fuelLeakLossLiters, 1);
});

test('Displayed pump sales preserve meter readings and distinguish partial, full and excess loss',()=>{
  for(const loss of [0,1,2.38,230.88]) {
    const {report,pump}=reportWithLoss(loss),original=structuredClone(pump);
    const shown=pumpSalesBreakdown(report,pump);
    close(shown.meteredLiters,2.38);close(shown.grossSales,2.38*88.8);
    close(shown.lossLiters,loss);
    assert.equal(shown.excessLoss,loss>2.38);
    if(!shown.excessLoss) {close(shown.paidLiters,2.38-loss);close(shown.paidSales,compute(report).fuelSales);}
    assert.deepEqual(pump,original);
  }
});

test('Displayed paid pump sales agree with the report across an overnight price change',()=>{
  const {report,pump}=reportWithLoss(1);report.shiftId='shift-3';
  report.midShiftBasePrices={...report.prices};
  report.midShiftPriceChanges=[{id:'after-midnight',product:'Regular',effectiveTime:'01:00',newPrice:90,readings:{[pump.id]:pump.opening+1}}];
  report.fuelLeakLosses[0].pricePerLiter=90;
  close(pumpSalesBreakdown(report,pump).paidSales,compute(report).fuelSales);
});

test('A metered leak during a price-changing shift uses the selected actual selling price', () => {
  const {report, pump} = reportWithLoss(1);
  report.midShiftBasePrices = {...report.prices};
  report.midShiftPriceChanges = [{id: 'price-change', product: 'Regular', effectiveTime: '09:00', newPrice: 90, readings: {[pump.id]: pump.opening + 1}}];
  assert.match(validateFuelLeakLosses(report), /Select the selling price/);
  report.fuelLeakLosses[0].pricePerLiter = 90;
  assert.equal(validateFuelLeakLosses(report), '');
  const original = structuredClone(report); original.fuelLeakLosses = [];
  close(compute(original).expectedCash - compute(report).expectedCash, 90);
  report.fuelLeakLosses[0].pricePerLiter = 999;
  assert.match(validateFuelLeakLosses(report), /Select the selling price/);
});

test('Legacy reports without losses retain identical computed totals and loss data survives normalization', () => {
  const {report} = reportWithLoss();
  const normalized = normalizeReport(JSON.parse(JSON.stringify(report)), report.branch, report.date, report.shiftId);
  assert.deepEqual(normalized.fuelLeakLosses, report.fuelLeakLosses);
  const legacy = structuredClone(report); delete legacy.fuelLeakLosses;
  const explicit = structuredClone(legacy); explicit.fuelLeakLosses = [];
  assert.deepEqual(compute(legacy), compute(explicit));
});

test('Invalid, duplicate, mismatched, excess or unexplained submission losses are rejected', () => {
  const {report} = reportWithLoss();
  assert.equal(validateFuelLeakLosses(report, {requireNotes: true}), '');
  for (const liters of [-1, 'invalid', Infinity, 2.4]) {
    const invalid = structuredClone(report); invalid.fuelLeakLosses[0].liters = liters;
    assert.ok(validateFuelLeakLosses(invalid));
  }
  const duplicate = structuredClone(report); duplicate.fuelLeakLosses.push({...duplicate.fuelLeakLosses[0]});
  assert.match(validateFuelLeakLosses(duplicate), /unique reference/);
  const wrong = structuredClone(report); wrong.fuelLeakLosses[0].product = 'Premium';
  assert.match(validateFuelLeakLosses(wrong), /pump must belong/);
  const noNote = structuredClone(report); noNote.fuelLeakLosses[0].notes = '';
  assert.equal(validateFuelLeakLosses(noNote), '');
  assert.match(validateFuelLeakLosses(noNote, {requireNotes: true}), /Explain/);
  const overlap = structuredClone(report); overlap.tankRows[1].calibration = 1;
  assert.match(validateFuelLeakLosses(overlap), /Calibration and metered leak loss/);
});

test('Pilot draft save persists and audits losses; stale edits, excess volume and submitted reports remain protected', async () => {
  const {state, report, key, cashier} = fixture();
  const pump = report.pumpRows.find(row => row.product === 'Regular');
  pump.closing = pump.opening + 2.38; pump.closingEntered = true;
  report.fuelLeakLosses = [{id: 'fixture-loss', product: 'Regular', pumpRowId: pump.id, liters: 2.38, notes: 'Leak reported by manager.'}];
  const saved = await runAction(state, cashier, '/api/reports/save', {report, operation: 'draft'});
  assert.deepEqual(saved.result.report.fuelLeakLosses, report.fuelLeakLosses);
  assert.ok(saved.state.audit.some(event => event.action === 'fuel-leak-loss-changed' && event.reportKey === key && event.after[0].liters === 2.38));
  const stale = structuredClone(saved.result.report); stale.pilotRevision = 0;
  await assert.rejects(runAction(saved.state, cashier, '/api/reports/save', {report: stale}), /changed on another device/);
  const excess = structuredClone(saved.result.report); excess.fuelLeakLosses[0].liters = 3;
  await assert.rejects(runAction(saved.state, cashier, '/api/reports/save', {report: excess}), /cannot exceed/);
  const locked = structuredClone(saved.state); locked.reports[key].confirmed = true;
  await assert.rejects(runAction(locked, cashier, '/api/reports/save', {report: saved.result.report}), /locked/);
});
