import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { compute, normalizeReport } from '../src/accounting-engine.js';
import { additionalReviewFlags } from '../src/accounting-review.js';
import { midShiftReadingIssues, midShiftReadingValue, reportStartingPrice, midShiftChangeHasDetails } from '../src/mid-shift-price-change.js';
import { midShiftChangeOrder, midShiftSalesBreakdown } from '../src/mid-shift-sales-breakdown.js';
import { reconcileSources } from '../pilot/state.mjs';
import { fixture } from './pilot-fixture.mjs';
import { authoritativePoRowsForReport } from '../api/_shared/po.js';
import { runAction } from '../pilot/service.mjs';
import { validateSubmission } from '../api/reports/save.js';

function extracts(file, names, context) {
  const source=fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replaceAll('\r','');
  const bodies=names.map(name=>source.match(new RegExp('function '+name+'\\([^]*?\\n\\}'))?.[0]);
  assert(bodies.every(Boolean),file);
  return vm.runInNewContext(bodies.join('\n')+'\n({'+names.join(',')+'})',context);
}

test('empty optional price-change drafts do not block Pondol or change its sales price',()=>{
  const report={branch:'Pondol',shiftId:'shift-1',prices:{Premium:75},midShiftBasePrices:{Premium:70},
    midShiftPriceChanges:[{id:'empty',product:'Premium',effectiveTime:'',newPrice:0,readings:{}}],
    pumpRows:[{id:'p',pump:'Pump 1',nozzle:'Premium',product:'Premium',opening:1000,closing:1100,closingEntered:true}],tankRows:[]};
  assert.equal(midShiftChangeHasDetails(report.midShiftPriceChanges[0]),false);
  assert.deepEqual(midShiftReadingIssues(report),[]);
  assert.equal(reportStartingPrice(report,'Premium'),75);
  assert.deepEqual(midShiftSalesBreakdown(report),[]);
  const context={n:v=>Number(v)||0,midShiftReadingValue,midShiftChangeHasDetails,CRITICAL_GROSS_SALES_THRESHOLD:1e9};
  for(const file of ['App.jsx','PilotApp.jsx','accounting-engine.js']) {
    const warnings=extracts(file,['reportWarnings'],context).reportWarnings;
    assert.equal(warnings(report,{grossSales:7500}).length,0,file);
    assert.ok(warnings({...report,midShiftPriceChanges:[{...report.midShiftPriceChanges[0],newPrice:76}]},{grossSales:7500}).length>0,file);
  }
  assert.equal(midShiftChangeHasDetails({...report.midShiftPriceChanges[0],effectiveTime:'10:00'}),true);
  assert.equal(midShiftChangeHasDetails({...report.midShiftPriceChanges[0],readings:{p:1050}}),true);
  assert.equal(midShiftChangeHasDetails({...report.midShiftPriceChanges[0],confirmedAt:'2026-10-08T02:00:00Z'}),true);
});

test('all calculation copies preserve confirmation and photos when reports are normalized',()=>{
  const {report}=fixture();
  const change={id:'saved',product:'Regular',effectiveTime:'09:00',newPrice:70,readings:{},confirmedAt:'2026-09-23T01:00:00Z',photoRequired:true,readingPhotos:{nozzle:{photo_path:'/api/pilot/photo?id=immutable',readingConfirmed:true}}};
  report.midShiftPriceChanges=[change];
  const normalized=normalizeReport(report,report.branch,report.date,report.shiftId,report.prices);
  assert.deepEqual(normalized.midShiftPriceChanges,[change]);
  for(const file of ['App.jsx','PilotApp.jsx','accounting-engine.js']) {
    const normalize=extracts(file,['normalizeReport'],{createReport:()=>structuredClone(report),defaultPrices:()=>({}),repairAutoApprovedCorrection:r=>r,shiftById:()=>({label:'Shift 1'}),FUEL_TYPES:['Premium','Regular','Diesel'],PUMP_CONFIG_VERSION:'test',buildPumpRows:()=>[],reportCompleted:()=>true,pumpCarryKey:r=>r.id,baselineConfirmed:()=>true,n:v=>Number(v)||0,uid:()=>'',pointsWithdrawnFromRedemptions:()=>0,hasActualCashCounted:()=>false,cleanDeductions:d=>d}).normalizeReport;
    const actual=normalize(report,report.branch,report.date,report.shiftId,report.prices);
    assert.deepEqual(JSON.parse(JSON.stringify(actual.midShiftPriceChanges)),[change],file);
  }
});

test('all Admin and server review lists include POS and imported-source warnings',()=>{
  const context={additionalReviewFlags,n:v=>Number(v)||0,pumpLitersSold:()=>0,REVIEW_LITERS_THRESHOLD:1500,REVIEW_CASH_OVERAGE_THRESHOLD:100,REVIEW_CASH_VARIANCE_THRESHOLD:1500};
  for(const file of ['App.jsx','PilotApp.jsx','accounting-engine.js']) {
    const review=extracts(file,['reportReviewFlags'],context).reportReviewFlags;
    for(const category of ['REDEMPTION','ONLINE_PAY','MANUAL_DEDUCTION']) {
      const report={confirmed:true,pilot:true,pumpRows:[],integrationIssues:[{category,detail:'Review evidence'}]};
      assert.equal(review(report,{totalLiters:0,cashVariance:0}).length,1,file+category);
      assert.equal(review({...report,integrationIssues:[],checkCategories:[]},{totalLiters:0,cashVariance:-2000}).length,1,file+'stale empty categories');
    }
  }
});

test('a later lower totalizer cannot create negative price segments or disagree with the sales breakdown',()=>{
  const {report}=fixture(),row={id:'nozzle',pump:'Pump 1',nozzle:'Regular',product:'Regular',opening:1000,closing:1100,closingEntered:true};
  report.pumpRows=[row];report.prices.Regular=80;report.midShiftBasePrices={Regular:80};report.confirmed=true;
  report.midShiftPriceChanges=[{id:'first',product:'Regular',effectiveTime:'09:00',newPrice:85,readings:{nozzle:1080}},{id:'second',product:'Regular',effectiveTime:'10:00',newPrice:90,readings:{nozzle:1050}}];
  assert.equal(midShiftReadingIssues(report).length,1);
  const expected=80*80+20*85;
  assert.equal(compute(report).fuelSales,expected);
  assert.equal(midShiftSalesBreakdown(report).reduce((sum,r)=>sum+r.sales,0),expected);
  for(const file of ['App.jsx','PilotApp.jsx','accounting-engine.js']) {
    const fn=extracts(file,['sortedMidShiftChanges','validMidShiftChangeForRow','pumpRowSales'],{n:v=>Number(v)||0,midShiftReadingValue,midShiftChangeOrder,reportStartingPrice}).pumpRowSales;
    assert.equal(fn(report,row),expected,file);
  }
  assert.ok(additionalReviewFlags(report).includes('Price-change readings need review'));
});

test('source disappearance persists a report warning, retains cash evidence and clears only after recovery',()=>{
  const {state,report,key}=fixture();report.confirmed=true;report.actualCashCounted=1000;report.cashDenominations={1000:1};
  state.reports[key]=report;
  const row={id:'payment',branch:'Liloan',date:report.date,shiftId:report.shiftId,amount:500,status:'PAID'};
  const incoming={pay:[row],po:[],cvCashEvents:[],sourceFingerprint:'test'};
  reconcileSources(state,structuredClone(incoming));
  const cash=report.actualCashCounted,expected=compute(report).expectedCash;
  reconcileSources(state,{...incoming,pay:[]});
  assert.equal(compute(report).expectedCash,expected);assert.equal(report.actualCashCounted,cash);
  assert.equal(report.checkRequired,true);assert.ok(report.checkCategories.includes('ONLINE_PAY'));
  assert.equal(report.integrationIssues.filter(i=>i.source==='Source reconciliation').length,1);
  const revision=report.pilotRevision;
  reconcileSources(state,{...incoming,pay:[]});assert.equal(report.pilotRevision,revision);
  reconcileSources(state,structuredClone(incoming));assert.equal(report.integrationIssues.length,0);
  assert.equal(report.actualCashCounted,cash);assert.deepEqual(report.cashDenominations,{1000:1});
});

test('per-report PO deductions load beyond 1,000 rows with stable ordering and fail on incomplete import',async()=>{
  const calls=[],rows=Array.from({length:1001},(_,i)=>({id:'po-'+i,amount:1,transaction_at:'2026-10-07T01:00:00Z'}));
  let fail=false;
  const query={select(){return this;},eq(){return this;},order(key){calls.push(key);return this;},async range(from,to){return fail&&from>0?{error:Error('page unavailable')}:{data:rows.slice(from,to+1)};}};
  const db={from:()=>query},report={branch:'Mabolo',date:'2026-10-07',shiftId:'shift-1'};
  const imported=await authoritativePoRowsForReport(db,report);
  assert.equal(imported.length,1001);assert.equal(imported.reduce((sum,r)=>sum+r.amount,0),1001);
  assert.deepEqual(calls,['transaction_at','id','transaction_at','id']);
  fail=true;await assert.rejects(authoritativePoRowsForReport(db,report),/unavailable/);
});

test('manager confirmation and report submission reject decreasing price-change readings before carrying prices',async()=>{
  const {state,report,key,manager}=fixture();
  report.pumpRows=report.pumpRows.map(row=>({...row,closing:Number(row.opening)+100,closingEntered:true}));
  const change=(id,time,offset,confirmedAt='')=>({id,product:'Regular',effectiveTime:time,newPrice:70,confirmedAt,readings:Object.fromEntries(report.pumpRows.filter(row=>row.product==='Regular').map(row=>[row.id,Number(row.opening)+offset]))});
  report.midShiftPriceChanges=[change('first','09:00',80,'2026-09-23T01:00:00Z'),change('second','10:00',50)];
  state.reports[key]=report;const before=structuredClone(state.priceBook);
  await assert.rejects(runAction(state,manager,'/api/demo/midshift-confirm',{reportKey:key,changeId:'second'}),/time order/);
  assert.deepEqual(state.priceBook,before);
  assert.match(validateSubmission(report),/time order/);
});

test('CV amount changes stay at the observed release and remain visible until the source recovers',()=>{
  const {state,report,key}=fixture();report.confirmed=true;state.reports[key]=report;
  const voucher={id:'voucher',sourceVoucherId:'voucher',reference:'CV1',branch:'Liloan',date:report.date,shiftId:report.shiftId,amount:100,status:'APPROVED',fundingSource:'STATION_CASH',category:'OPEX',item:'Supplies'};
  const incoming={pay:[],po:[],cvCashEvents:[voucher],sourceFingerprint:'test'};
  reconcileSources(state,structuredClone(incoming));
  const expected=compute(report).expectedCash;
  reconcileSources(state,{...incoming,cvCashEvents:[{...voucher,amount:200}]});
  assert.equal(compute(report).expectedCash,expected);assert.equal(report.purchaseRows.length,1);
  assert.ok(report.checkCategories.includes('MANUAL_DEDUCTION'));
  assert.ok(additionalReviewFlags(report).includes('Cash voucher needs review'));
  reconcileSources(state,structuredClone(incoming));
  assert.equal(report.integrationIssues.length,0);assert.equal(report.purchaseRows.length,1);
});
