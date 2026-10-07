import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './pilot-fixture.mjs';
import { reconcileSources } from '../pilot/state.mjs';
import { accountingCashVouchers } from '../pilot/cv-allocations.mjs';
import { compute, reportKey } from '../src/accounting-engine.js';

function prepared() {
  const f=fixture();
  f.report.confirmed=true;f.report.actualCashCounted=1000;f.state.reports[f.key]=f.report;
  const destination={...structuredClone(f.report),date:'2026-09-23',shiftId:'shift-3',purchaseRows:[],actualCashCounted:500};
  const targetKey=reportKey(destination.branch,destination.date,destination.shiftId);f.state.reports[targetKey]=destination;
  const cv={id:'cv1',sourceVoucherId:'cv1',reference:'CV1',branch:'Liloan',date:'2026-09-23',shiftId:'shift-1',amount:2835,status:'APPROVED',fundingSource:'STATION_CASH',category:'Personal',item:'Tubil Kuya JP',assignmentBasis:'created_at'};
  const incoming={pay:[],po:[],cvCashEvents:[cv],sourceFingerprint:'source'};
  reconcileSources(f.state,structuredClone(incoming));
  const override={id:'approved-move',fromDate:cv.date,fromShiftId:cv.shiftId,toDate:destination.date,toShiftId:destination.shiftId,reason:'Owner requested accounting allocation correction',approvedBy:'Owner',approvedAt:'2026-09-24T00:00:00Z'};
  f.state.cvAllocationOverrides={cv1:override};
  return {...f,targetKey,cv,incoming,override};
}

test('approved CV allocation moves once, preserves source and physical evidence, and survives refresh and JSONB reload',()=>{
  const {state,key,targetKey,incoming,cv}=prepared();
  const before=Object.fromEntries([key,targetKey].map(k=>[k,compute(state.reports[k]).expectedCash]));
  const counts=[state.reports[key].actualCashCounted,state.reports[targetKey].actualCashCounted];
  const deposits=structuredClone(state.deposits);
  reconcileSources(state,structuredClone(incoming));
  assert.equal(state.reports[key].purchaseRows.length,0);assert.equal(state.reports[targetKey].purchaseRows.length,1);
  assert.equal(compute(state.reports[key]).expectedCash,before[key]+2835);
  assert.equal(compute(state.reports[targetKey]).expectedCash,before[targetKey]-2835);
  assert.deepEqual(state.cvCashEvents,[cv]);assert.deepEqual(state.sourceAlerts,[]);
  assert.deepEqual([state.reports[key].actualCashCounted,state.reports[targetKey].actualCashCounted],counts);assert.deepEqual(state.deposits,deposits);
  const revision=state.reports[targetKey].pilotRevision,auditCount=state.audit.length;
  const persisted=JSON.parse(JSON.stringify(state));
  reconcileSources(persisted,structuredClone(incoming));reconcileSources(persisted,structuredClone(incoming));
  assert.equal(persisted.reports[targetKey].pilotRevision,revision);assert.equal(persisted.audit.length,auditCount);
  assert.equal(persisted.reports[targetKey].purchaseRows[0].accountingAllocation.id,'approved-move');
});

test('changed and missing source voucher warnings follow the approved accounting shift',()=>{
  const {state,targetKey,incoming,cv}=prepared();reconcileSources(state,structuredClone(incoming));
  for(const events of [[{...cv,amount:2885}],[]]){
    reconcileSources(state,{...incoming,cvCashEvents:events});
    assert.equal(state.reports[targetKey].purchaseRows[0].amount,2835);
    assert.equal(state.sourceAlerts[0].reportKey,targetKey);assert.equal(state.reports[targetKey].checkRequired,true);
  }
  reconcileSources(state,structuredClone(incoming));assert.deepEqual(state.sourceAlerts,[]);
});

test('explicit CV cancellation removes the deduction from its approved destination',()=>{
  const {state,key,targetKey,incoming}=prepared();reconcileSources(state,structuredClone(incoming));
  reconcileSources(state,{...incoming,cvCashEvents:[],cvExclusions:[{id:'cv1',status:'cancelled'}]});
  assert.equal(state.reports[key].purchaseRows.length,0);assert.equal(state.reports[targetKey].purchaseRows.length,0);
  assert.equal(state.cvCashEvents.length,0);assert.deepEqual(state.sourceAlerts,[]);
});

test('drafts use the same CV allocation; invalid or historical destinations fail closed',()=>{
  const {state,key,targetKey}=prepared();
  assert.equal(accountingCashVouchers(state,state.reports[key]).length,0);
  assert.equal(accountingCashVouchers(state,state.reports[targetKey]).length,1);
  state.cvAllocationOverrides.cv1.toDate='2026-09-22';
  assert.throws(()=>accountingCashVouchers(state,state.reports[key]),/Invalid approved/);
});
