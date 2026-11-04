import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './pilot-fixture.mjs';
import { reconcileSources } from '../pilot/state.mjs';
import { refreshPosEvidence, refreshPosReport, attachPosVerification } from '../pilot/pos-redemptions.mjs';
import { statePatch } from '../pilot/storage.mjs';
import { sameReviewIssues } from '../pilot/review-issues.mjs';
import { compute } from '../src/accounting-engine.js';
import { posRedemptionComparison } from '../src/pos-redemptions.js';

test('unchanged polling journals fresh metadata once, without copying historical reports', async () => {
  const { state, key } = fixture();
  const read=async()=>({rows:[],points:[]});
  await refreshPosEvidence(state,{enabled:true,read,now:'2026-10-01T00:00:00Z'});
  const before=structuredClone(state);
  await refreshPosEvidence(state,{enabled:true,read,now:new Date().toISOString(),force:true});
  const patch=statePatch(before,state);
  assert.equal(patch.upserts.filter(r=>r.section==='reports').length,0);
  assert.deepEqual(patch.upserts.map(r=>r.key).sort(),['attemptedAt','verifiedAt']);
  assert.equal(patch.audit.length,0);
  const persisted=before.reports[key];
  const projected=refreshPosReport(persisted,{...state.posRedemptionSync,_deferred:true});
  assert.equal(projected.posRedemptions.verifiedAt,state.posRedemptionSync.verifiedAt);
  assert.equal(posRedemptionComparison(projected).fresh,true);
  assert.equal(compute(projected).expectedCash,compute(persisted).expectedCash);
});

test('actual redemption changes and failed verification are still journaled', async () => {
  const { state, key } = fixture();
  const now=new Date().toISOString();
  await refreshPosEvidence(state,{enabled:true,read:async()=>({rows:[],points:[]}),now});
  let before=structuredClone(state);
  await refreshPosEvidence(state,{enabled:true,force:true,now,read:async()=>({rows:[{id:'new',date:state.reports[key].date,shiftId:state.reports[key].shiftId,type:'Cash',amount:40,quantity:0}],points:[]})});
  assert.equal(statePatch(before,state).upserts.find(r=>r.section==='reports'&&r.key===key).data.deductions.posRedemption,40);
  assert.ok(statePatch(before,state).audit.some(a=>a.action==='pos-shift-reconciled'));
  before=structuredClone(state);
  await refreshPosEvidence(state,{enabled:true,force:true,now,read:async()=>{throw Error('offline');}});
  const patch=statePatch(before,state);
  assert.equal(patch.upserts.find(r=>r.section==='reports'&&r.key===key).data.posRedemptions.status,'unavailable');
  assert.equal(state.reports[key].deductions.posRedemption,40);
  assert.ok(patch.audit.some(a=>a.action==='pos-redemptions-unavailable'));
});

test('manager and POS warnings do not alternate order into false accounting edits',async()=>{
  const {state,key}=fixture();
  state.startDate='2026-10-03';
  const report=state.reports[key];
  report.date='2026-10-04';report.confirmed=true;
  report.managerReconciliation={version:1,approvedBy:'Owner',approvedAt:'2026-11-03T00:00:00Z',sourceSha256:'a'.repeat(64),grossFuelSales:0,calibrationCash:0,cashVoucherTotal:10,otherCashOutlays:0,cashCount:0,photoConflicts:[{id:'preserved'}]};
  const incoming={pay:[],po:[],cvCashEvents:[],sourceFingerprint:'unchanged'};
  const read=async()=>({rows:[],points:[{id:'invalid',date:report.date,shiftId:report.shiftId,issue:'Invalid points or liters in POS',points:null}]});
  reconcileSources(state,structuredClone(incoming));
  await refreshPosEvidence(state,{enabled:true,force:true,read});
  const before=structuredClone(state),count=state.audit.length,revision=state.reports[key].pilotRevision;
  for(let i=0;i<3;i++){
    reconcileSources(state,structuredClone(incoming));
    await refreshPosEvidence(state,{enabled:true,force:true,read});
  }
  assert.equal(state.audit.length,count);
  assert.equal(state.reports[key].pilotRevision,revision);
  assert.equal(statePatch(before,state).upserts.filter(r=>r.section==='reports').length,0);
  assert.equal(state.reports[key].integrationIssues.filter(i=>i.source==='Manager reconciliation').length,2);
  assert.equal(state.reports[key].integrationIssues.filter(i=>i.source==='FuelTech POS').length,1);
  assert.equal(state.reports[key].checkRequired,true);
});

test('warning comparison preserves duplicate counts and detects changed details',()=>{
  const a={source:'POS',category:'REDEMPTION',detail:'a'},b={source:'CV',category:'MANUAL_DEDUCTION',detail:'b'};
  assert.equal(sameReviewIssues([a,b],[{...b},{...a}]),true);
  assert.equal(sameReviewIssues([a,a,b],[a,b,b]),false);
  assert.equal(sameReviewIssues([a],[{...a,detail:'changed'}]),false);
});

test('the regular Admin report path displays the current verification time without a report write',async()=>{
  const {state,key}=fixture();
  await refreshPosEvidence(state,{enabled:true,read:async()=>({rows:[],points:[]}),now:'2026-10-01T00:00:00Z'});
  const report=structuredClone(state.reports[key]),now=new Date().toISOString();
  const values={status:'verified',startDate:report.date,verifiedAt:now,attemptedAt:now};
  const db={from(table){assert.equal(table,'fueltech_pilot_documents');const query=new Proxy({},{get:(_target,k)=>k==='then'?resolve=>resolve({data:Object.entries(values).map(([item_key,data])=>({item_key,data})),error:null}):()=>query});return query;}};
  const rows=await attachPosVerification(db,[{data:report}]);
  assert.equal(posRedemptionComparison(rows[0].data).fresh,true);
  assert.equal(report.posRedemptions.verifiedAt,'2026-10-01T00:00:00Z');
  assert.equal(compute(rows[0].data).expectedCash,compute(report).expectedCash);
});
