import assert from 'node:assert/strict';
import test from 'node:test';
import {midShiftSalesBreakdown} from '../src/mid-shift-sales-breakdown.js';
import { computeReportCash, computeReportFuel, buildDailyHealth } from '../api/_shared/health.js';

test('health and owner fuel totals honor the starting price and a change at the opening reading', () => {
  const report = {
    branch: 'Liloan', date: '2026-10-05', shiftId: 'shift-1', pilot: true,
    prices: { Regular: 90 }, midShiftBasePrices: { Regular: 80 },
    pumpRows: [{ id: 'regular', product: 'Regular', opening: 1000, closing: 1100 }],
    midShiftPriceChanges: [{ product: 'Regular', effectiveTime: '10:00', newPrice: 90, readings: { regular: 1050 } }],
    actualCashCounted: 8400,
  };
  assert.deepEqual(computeReportFuel(report), { liters: 100, sales: 8500 });
  assert.equal(computeReportCash(report).cashVariance, -100);
  report.midShiftPriceChanges[0].readings.regular = 1000;
  assert.deepEqual(computeReportFuel(report), { liters: 100, sales: 9000 });
});

test('health respects the overnight sequence of mid-shift prices', () => {
  const report = {
    branch: 'Liloan', date: '2026-10-05', shiftId: 'shift-3', prices: { Diesel: 80 },
    pumpRows: [{ id: 'diesel', product: 'Diesel', opening: 1000, closing: 1100 }],
    midShiftPriceChanges: [
      { product: 'Diesel', effectiveTime: '23:00', newPrice: 90, readings: { diesel: 1020 } },
      { product: 'Diesel', effectiveTime: '01:00', newPrice: 100, readings: { diesel: 1060 } },
    ],
  };
  assert.deepEqual(computeReportFuel(report), { liters: 100, sales: 9200 });
});

test('historical counted cash and deposits remain separate in the health summary', () => {
  const report = {
    branch: 'Liloan', date: '2026-10-03', shiftId: 'shift-3', confirmed: true,
    oilSales: 1000, actualCashCounted: 850, deposits: [{ amount: 850, verified: true }],
  };
  const cash = computeReportCash(report);
  assert.equal(cash.expectedCash, 1000);
  assert.equal(cash.bankDeposit, 850);
  assert.equal(cash.cashVariance, -150);
  const health = buildDailyHealth({ date: report.date, reportRows: [{ report_key: 'Liloan__2026-10-03__shift-3', data: report }] });
  assert.equal(health.stations.find(row => row.branch === 'Liloan').cashVariance, -150);
  assert.equal(computeReportCash({ branch: 'Liloan', oilSales: 1000, deposits: [{ amount: 1100 }] }).cashVariance, 0);
});

test('a late CV approval changes expected cash while preserving the physical count', () => {
  const report = { branch: 'Liloan', oilSales: 1000, actualCashCounted: 800, pilot: true };
  assert.equal(computeReportCash(report).cashVariance, -200);
  const imported = { ...report, purchaseRows: [{ amount: 150, source: 'FuelTech CV' }] };
  assert.equal(computeReportCash(imported).cashVariance, -50);
  assert.equal(report.actualCashCounted, 800);
});

test('other stations keep their existing health calculation', () => {
  assert.equal(computeReportCash({ branch: 'Mabolo', oilSales: 1000, actualCashCounted: 800 }).cashVariance, 0);
});

test('archived and live station summaries price overnight changes in order using the original price', () => {
  const report = { branch: 'Pondol', shiftId: 'shift-3', prices: {Diesel: 100}, midShiftBasePrices: {Diesel: 80},
    pumpRows: [{id:'d',pump:'P',nozzle:'N',product:'Diesel',opening:100,closing:200}],
    midShiftPriceChanges: [
      {product:'Diesel',effectiveTime:'01:00',newPrice:100,readings:{'P|N|Diesel':160}},
      {product:'Diesel',effectiveTime:'23:00',newPrice:90,readings:{'P|N|Diesel':120}},
    ]};
  for (const pilot of [true,false]) assert.deepEqual(computeReportFuel({...report,pilot}), {liters:100,sales:9200});
});

test('an empty or invalid change reading cannot act as a verified zero', () => {
  const report={branch:'Mabolo',shiftId:'shift-1',prices:{Regular:90},midShiftBasePrices:{Regular:80},
    pumpRows:[{id:'p',product:'Regular',opening:0,closing:10,setupRequired:false}]};
  for (const [value,sales] of [['',800],['  ',800],['invalid',800],[null,800],[0,900],['0',900]]) {
    const change={product:'Regular',effectiveTime:'10:00',newPrice:90,readings:{p:value}};
    const current={...report,midShiftPriceChanges:[change]};
    for (const pilot of [true,false]) assert.deepEqual(computeReportFuel({...current,pilot}), {liters:10,sales});
    assert.equal(midShiftSalesBreakdown(current).reduce((sum,r)=>sum+r.sales,0),sales);
    const missingOpening={...current,pumpRows:[{...report.pumpRows[0],setupRequired:true}]};
    assert.deepEqual(midShiftSalesBreakdown(missingOpening),[]);
    assert.equal(computeReportFuel(missingOpening).sales,0);
  }
});
