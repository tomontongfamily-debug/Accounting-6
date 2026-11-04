import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, openingPhoto, openingPhotos } from './pilot-fixture.mjs';
import { prepareStationRollout } from '../pilot/station-rollout.mjs';
import { withStationRollout } from '../src/station-rollout.js';
import { runAction } from '../pilot/service.mjs';
import { compute } from '../src/accounting-engine.js';
import { ensureCurrentReports } from '../pilot/state.mjs';

function setup() {
  const {state}=fixture();state.mode='live';state.startDate='2026-10-03';
  prepareStationRollout(state,withStationRollout({mode:'live',start_date:state.startDate}));
  const key='Mabolo__2026-11-04__shift-3',cashier={role:'Cashier',branch:'Mabolo'};
  const report=structuredClone(state.reports[key]);
  report.cashierName='Opening photo test';report.coke.beginning=0;
  report.pumpRows=report.pumpRows.map((r,i)=>({...r,opening:i===0?0:10000+i*100}));
  report.tankRows=report.tankRows.map(r=>({...r,opening:1500}));
  return {state,key,cashier,report};
}

test('Opening Setup requires server-owned confirmed photos and carries real starting readings without creating sales',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-04T22:05:00+08:00')});
  let {state,key,cashier,report}=setup();
  await assert.rejects(runAction(state,cashier,'/api/reports/save',{report:{...report,baselineConfirmed:true}}),/Photograph and confirm every/);
  const forged={...report,baselineConfirmed:true,pumpRows:report.pumpRows.map(r=>({...r,photo_path:'/fake.jpg',readingConfirmed:true,closing:r.opening,closingEntered:true}))};
  await assert.rejects(runAction(state,cashier,'/api/reports/save',{report:forged}),/Photograph and confirm every/);
  state=await openingPhotos(state,report);
  const photoRows=structuredClone(state.reports[key].pumpRows);
  // A stale desktop draft cannot replace a phone-confirmed starting reading.
  report.pumpRows=report.pumpRows.map(r=>({...r,opening:999999}));
  const saved=await runAction(state,cashier,'/api/reports/save',{report:{...report,baselineConfirmed:true}});
  assert.deepEqual(saved.result.report.pumpRows,photoRows);
  assert.equal(saved.result.report.confirmed,true);
  assert.equal(compute(saved.result.report).grossSales,0);
  state=saved.state;ensureCurrentReports(state,'2026-11-05T04:05:00+08:00');
  const next=state.reports['Mabolo__2026-11-05__shift-1'];
  assert.equal(next.pumpRows[0].opening,0);
  assert.equal(next.pumpRows[1].opening,10100);
  assert.equal(next.tankRows[0].opening,1500);
  await assert.rejects(runAction(state,cashier,'/api/demo/photo',{reportKey:key,rowId:photoRows[0].id}),/locked/);
});

test('Opening photo retakes clear prior confirmation and reject stale revisions and unrelated photos',async()=>{
  let {state,key,cashier,report}=setup();
  const rowId=report.pumpRows[0].id;
  state=await openingPhoto(state,key,rowId,12345.67);
  const before=state.reports[key].pumpRows[0];
  const uploaded=await runAction(state,cashier,'/api/demo/photo',{reportKey:key,rowId,revision:before.readingRevision,replaceReading:true,data:'data:image/jpeg;base64,/9j/2Q=='},{uploadPhoto:async()=>{}});
  state=uploaded.state;const row=state.reports[key].pumpRows[0];
  assert.equal(row.opening,'');assert.equal(row.closing,'');assert.equal(row.readingConfirmed,false);assert.equal(row.ocr_result.status,'pending');
  await assert.rejects(runAction(state,cashier,'/api/demo/pump-reading',{reportKey:key,revision:before.readingRevision,row:{...before,closing:2,readingConfirmed:true}}),/another device/);
  await assert.rejects(runAction(state,cashier,'/api/demo/pump-reading',{reportKey:key,revision:row.readingRevision,row:{...row,photo_path:before.photo_path,closing:2,readingConfirmed:true}}),/does not belong/);
  const changed=await runAction(state,cashier,'/api/demo/pump-reading',{reportKey:key,revision:row.readingRevision,row:{...row,closing:12000.25,readingConfirmed:true,ocr_result:{status:'error',version:'fixture'}}});
  assert.equal(changed.result.report.pumpRows[0].opening,12000.25);
  assert.equal(changed.result.report.pumpRows[0].ocr_result.status,'error');
  const audit=state.audit.findLast(a=>a.action==='pump-photo-uploaded');
  assert.equal(audit.previousPhoto,before.photo_path);assert.equal(audit.previousOcr,12345.67);
});

test('Starting photos can be prepared before launch while setup confirmation keeps the scheduled lock',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-04T15:00:00+08:00')});
  let {state,cashier,report}=setup();
  state=await openingPhotos(state,report);
  assert.ok(state.reports['Mabolo__2026-11-04__shift-3'].pumpRows.every(r=>r.readingConfirmed));
  await assert.rejects(runAction(state,cashier,'/api/reports/save',{report:{...report,baselineConfirmed:true}}),/10:00 p.m./);
});
