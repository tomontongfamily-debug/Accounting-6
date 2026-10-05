import test from 'node:test';
import assert from 'node:assert/strict';
import { runAction } from '../pilot/service.mjs';
import { saveLivePilotCorrection } from '../pilot/repository.mjs';
import { correctionFixture, correctionDatabase } from './correction-fixture.mjs';

for(const status of ['pending','verified'])test(`Approved correction can replace a pump photo with a ${status} deposit and preserve its cash`,async()=>{
  let {state,report,key,admin,cashier}=correctionFixture(status);
  const act=async(session,route,input={},options={})=>{const out=await runAction(state,session,route,input,options);state=out.state;return out.result;};
  const deposits=structuredClone(state.deposits),cash=structuredClone(report.cashDenominations);
  const approval={...report,correctionRequest:{...report.correctionRequest,status:'approved',expiresAt:'2099-01-01T00:00:00Z'}};
  report=(await act(admin,'/api/reports/save',{report:approval,operation:'correction-decision'})).report;
  assert.equal(report.confirmed,false);assert.equal(report.cashCountConfirmed,true);assert.equal(report.actualCashCounted,500);
  assert.deepEqual(report.cashDenominations,cash);assert.deepEqual(state.deposits,deposits);
  assert.ok(Date.parse(report.correctionRequest.expiresAt)<Date.now()+24*60*60*1000+1000);
  const retry=await act(admin,'/api/reports/save',{report:approval,operation:'correction-decision'});
  assert.equal(retry.alreadyApproved,true);assert.equal(retry.report.pilotRevision,report.pilotRevision);
  const row=report.pumpRows[0];
  const replaced=await act(cashier,'/api/demo/photo',{reportKey:key,rowId:row.id,revision:row.readingRevision,replaceReading:true,data:'data:image/jpeg;base64,/9j/2Q=='},{uploadPhoto:async()=>{}});
  const cleared=(await act(cashier,'/api/demo/pump-report',{reportKey:key})).report;
  assert.equal(cleared.pumpRows[0].readingConfirmed,false);
  report=(await act(cashier,'/api/demo/pump-reading',{reportKey:key,revision:replaced.readingRevision,row:{...cleared.pumpRows[0],closing:Number(row.opening)+20,closingEntered:true,readingConfirmed:true,photo_path:replaced.photo_path}})).report;
  assert.equal(report.pumpRows[0].closing,Number(row.opening)+20);
  const checked=await act(cashier,'/api/demo/cash-check',{report});report=checked.report;
  assert.equal(checked.needsRecount,false);
  await assert.rejects(act(cashier,'/api/demo/cash-recount',{report,denominations:{100:6}}),/covered by a deposit/);
  report=(await act(cashier,'/api/reports/save',{report:{...report,actualCashCounted:999,cashDenominations:{100:9}},operation:'submit'})).report;
  assert.equal(report.confirmed,true);assert.equal(report.correctionRequest.status,'completed');
  assert.equal(report.actualCashCounted,500);assert.deepEqual(report.cashDenominations,cash);assert.deepEqual(state.deposits,deposits);
  await assert.rejects(act(cashier,'/api/demo/pump-reading',{reportKey:key,revision:report.pumpRows[0].readingRevision,row:report.pumpRows[0]}),/locked/);
});

test('A regular Admin approval persists in live state and the canonical report across refreshes',async()=>{
  const {state,report,key,admin}=correctionFixture();state.mode='live';
  const db=correctionDatabase(state);
  const approval={...report,correctionRequest:{...report.correctionRequest,status:'approved'}};
  const result=await saveLivePilotCorrection(db,admin,approval,'correction-decision');
  assert.equal(result.report.confirmed,false);assert.equal(db.data.reports[key].correctionRequest.status,'approved');
  assert.equal(db.mirrored[key].correctionRequest.status,'approved');
  const refreshed=await runAction(db.data,admin,'/api/store/load');
  assert.equal(refreshed.result.reportRows.find(r=>r.report_key===key).data.correctionRequest.status,'approved');
  // Older already-open Admin tabs still use "save".
  const retry=await saveLivePilotCorrection(db,admin,approval,'save');assert.equal(retry.alreadyApproved,true);
});

test('Other stations, pre-cutover reports and disabled/shadow modes keep their existing workflow',async()=>{
  const {state,report,admin}=correctionFixture();
  const approved={...report,correctionRequest:{...report.correctionRequest,status:'approved'}};
  const db=correctionDatabase(state);
  assert.equal(await saveLivePilotCorrection(db,admin,approved,'correction-decision'),null);
  state.mode='live';const live=correctionDatabase(state);
  assert.equal(await saveLivePilotCorrection(live,admin,{...approved,branch:'Mabolo'},'correction-decision'),null);
  assert.equal(await saveLivePilotCorrection(live,admin,{...approved,date:'2026-09-22'},'correction-decision'),null);
});

test('Changed requests and expired correction approvals cannot change saved readings',async()=>{
  const {state,report,key,admin,cashier}=correctionFixture();
  await assert.rejects(runAction(state,admin,'/api/reports/save',{report:{...report,correctionRequest:{id:'stale-request',status:'approved'}}}),error=>error.status===409&&error.staleDraft===true&&/request changed/.test(error.message));
  state.reports[key].confirmed=false;state.reports[key].correctionRequest.status='approved';state.reports[key].correctionRequest.expiresAt='2026-01-01T00:00:00Z';
  await assert.rejects(runAction(state,cashier,'/api/demo/pump-reading',{reportKey:key,revision:3,row:state.reports[key].pumpRows[0]}),/approval expired/);
  await assert.rejects(runAction(state,cashier,'/api/demo/photo',{reportKey:key,rowId:state.reports[key].pumpRows[0].id,revision:3,replaceReading:true,data:'data:image/jpeg;base64,/9j/2Q=='}),/approval expired/);
});

test('An unchanged request can be approved after another save without overwriting the newer report fields',async()=>{
  const {state,report,key,admin}=correctionFixture();
  state.reports[key].pilotRevision=12;state.reports[key].notes='Newer saved note';state.reports[key].oilSales=30;
  const out=await runAction(state,admin,'/api/reports/save',{report:{...report,correctionRequest:{...report.correctionRequest,status:'approved'}}});
  assert.equal(out.result.report.pilotRevision,13);assert.equal(out.result.report.notes,'Newer saved note');assert.equal(out.result.report.oilSales,30);
  const changed=structuredClone(state);changed.reports[key].correctionRequest.requestedAt='2026-09-23T06:00:00Z';
  await assert.rejects(runAction(changed,admin,'/api/reports/save',{report:{...report,correctionRequest:{...report.correctionRequest,status:'approved'}}}),/request changed/);
});

test('Rejecting an open correction does not turn an unfinished pump photo into a submitted report',async()=>{
  const {state,report,key,admin,cashier}=correctionFixture();
  const approved=await runAction(state,admin,'/api/reports/save',{report:{...report,correctionRequest:{...report.correctionRequest,status:'approved'}}});
  approved.state.reports[key].pumpRows[0].readingConfirmed=false;
  const source=approved.state.reports[key];
  const rejected=await runAction(approved.state,admin,'/api/reports/save',{report:{...source,correctionRequest:{...source.correctionRequest,status:'rejected'}}});
  assert.equal(rejected.result.report.confirmed,false);
  await assert.rejects(runAction(rejected.state,cashier,'/api/reports/save',{report:rejected.result.report}),/correction was rejected/);
});
