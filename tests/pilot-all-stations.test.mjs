import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, openingPhotos } from './pilot-fixture.mjs';
import { prepareStationRollout } from '../pilot/station-rollout.mjs';
import { ensureCurrentReports } from '../pilot/state.mjs';
import { runAction } from '../pilot/service.mjs';
import { compute, reportKey } from '../src/accounting-engine.js';
import { ALL_STATIONS, withStationRollout, stationOpeningSlot } from '../src/station-rollout.js';
import { openingReady } from '../src/pilot-opening.js';
import { normalizeSources, STATION_IDS } from '../pilot/integrations.mjs';
import { hasPumpOpening, pumpMeterLiters } from '../src/fuel-leak-loss.js';

function rollout(){
  const {state}=fixture();state.mode='live';state.startDate='2026-10-03';
  const config=withStationRollout({mode:'live',start_date:state.startDate});
  const old=structuredClone(state);
  prepareStationRollout(state,config);
  return {state,config,old};
}

test('rollout preserves every Liloan record and creates empty setup in the right slot for five stations',()=>{
  const {state,config,old}=rollout();
  for(const [key,report] of Object.entries(old.reports))assert.deepEqual(state.reports[key],report);
  assert.deepEqual(state.deposits,old.deposits);assert.deepEqual(state.photos,old.photos);
  for(const branch of ALL_STATIONS.filter(b=>b!=='Liloan')){
    assert.deepEqual(stationOpeningSlot(config,branch),{date:'2026-11-04',shiftId:'shift-3'});
    const report=state.reports[reportKey(branch,'2026-11-04','shift-3')];
    assert.equal(report.confirmed,false);assert.equal(report.baselineReport,true);
    assert.ok(report.pumpRows.every(r=>r.opening===''));assert.ok(report.tankRows.every(r=>r.opening===''));
    assert.equal(compute(report).grossSales,0);assert.equal(report.actualCashCounted,0);
  }
  const snapshot=structuredClone(state);prepareStationRollout(state,config);assert.deepEqual(state,snapshot);
  ensureCurrentReports(state,'2026-11-04T23:00:00+08:00');
  assert.equal(state.reports['Mabolo__2026-11-04__shift-1'],undefined);
});

for(const branch of ALL_STATIONS.filter(b=>b!=='Liloan'))test(branch+': setup, station isolation and next-shift carry-forward',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-04T22:05:00+08:00')});
  let {state,config}=rollout();const key=reportKey(branch,'2026-11-04','shift-3');
  const report=structuredClone(state.reports[key]);report.cashierName='Rollout test';
  report.pumpRows=report.pumpRows.map((r,i)=>({...r,opening:10000+i*1000}));
  report.tankRows=report.tankRows.map(r=>({...r,opening:1500}));report.coke.beginning=30;report.baselineConfirmed=true;
  await assert.rejects(runAction(state,{role:'Cashier',branch:branch==='Arpili'?'Mabolo':'Arpili'},'/api/reports/save',{report}),/another station/);
  state=await openingPhotos(state,report);
  const result=await runAction(state,{role:'Cashier',branch},'/api/reports/save',{report});
  state=result.state;assert.equal(openingReady(result.result.report,config),true);
  assert.equal(compute(result.result.report).grossSales,0);
  ensureCurrentReports(state,'2026-11-05T04:00:00+08:00');
  const next=state.reports[reportKey(branch,'2026-11-05','shift-1')];
  assert.equal(next.pumpRows[0].opening,10000);assert.equal(next.tankRows[0].opening,1500);assert.equal(next.coke.beginning,30);
  await assert.rejects(runAction(state,{role:'Cashier',branch},'/api/reports/save',{report:next}),/4:00 a.m./);
  await assert.rejects(runAction(state,{role:'Cashier',branch},'/api/reports/save',{report}),/already confirmed/);
});

test('setup cannot be confirmed before tonight and cannot omit or fabricate opening values',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-04T21:59:59+08:00')});
  const {state}=rollout(),report=structuredClone(state.reports['Mabolo__2026-11-04__shift-3']);
  report.baselineConfirmed=true;
  await assert.rejects(runAction(state,{role:'Cashier',branch:'Mabolo'},'/api/reports/save',{report}),/10:00 p.m./);
  t.mock.timers.setTime(Date.parse('2026-11-04T22:00:00+08:00'));
  await assert.rejects(runAction(state,{role:'Cashier',branch:'Mabolo'},'/api/reports/save',{report}),/non-negative amount/);
});

test('each station imports its own payments and vouchers without duplicating Liloan data',()=>{
  for(const branch of ALL_STATIONS){
    const sources=normalizeSources({pay:[{id:'pay-'+branch,station_id:STATION_IDS[branch],status:'PAID',paid_at:'2026-11-05T05:00:00+08:00',base_amount:100}],cv:[{id:'cv-'+branch,ref:'CV',station:branch.toLowerCase(),status:'approved',payment_method:'cash',created_at:'2026-11-05T05:00:00+08:00',amount:50,category:{name:'OPEX'}}]},'2026-11-05',branch);
    assert.equal(sources.pay[0].branch,branch);assert.equal(sources.cvCashEvents[0].branch,branch);
    assert.equal(sources.pay[0].amount,100);assert.equal(sources.cvCashEvents[0].amount,50);
  }
});

test('a confirmed zero meter opening counts sales and manual redemptions persist with cash review invalidation',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-05T04:05:00+08:00')});
  let {state}=rollout();
  const setup=structuredClone(state.reports['Mabolo__2026-11-04__shift-3']);
  setup.cashierName='Test';setup.pumpRows=setup.pumpRows.map(r=>({...r,opening:0}));
  setup.tankRows=setup.tankRows.map(r=>({...r,opening:0}));setup.coke.beginning=0;setup.baselineConfirmed=true;
  state=await openingPhotos(state,setup);
  state=(await runAction(state,{role:'Cashier',branch:'Mabolo'},'/api/reports/save',{report:setup})).state;
  ensureCurrentReports(state);
  const key='Mabolo__2026-11-05__shift-1',report=structuredClone(state.reports[key]);
  assert.equal(hasPumpOpening(report.pumpRows[0]),true);
  assert.equal(pumpMeterLiters({...report.pumpRows[0],closing:10}),10);
  assert.equal(pumpMeterLiters({opening:0,closing:10}),0);
  report.pumpRows[0].closing=10;
  report.deductions.cashRedemption=100;report.deductions.fuelRedemption=50;
  state.reports[key].cashReviewState='checked';state.reports[key].reviewedExpectedCash=compute(state.reports[key]).expectedCash;
  const saved=await runAction(state,{role:'Cashier',branch:'Mabolo'},'/api/reports/save',{report});
  assert.equal(saved.result.report.deductions.cashRedemption,100);
  assert.equal(saved.result.report.deductions.fuelRedemption,50);
  assert.equal(saved.result.report.pointsWithdrawn,150);
  assert.equal(saved.result.report.cashReviewState,'');
});
