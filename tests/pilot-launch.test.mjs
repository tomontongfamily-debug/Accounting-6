import test from 'node:test';
import assert from 'node:assert/strict';
import {openingReady,launchStatus} from '../pilot/launch.mjs';
import {fixture} from './pilot-fixture.mjs';
import {reconcileSources} from '../pilot/state.mjs';
import {compute} from '../src/accounting-engine.js';
import {computeReportCash,buildDailyHealth} from '../api/_shared/health.js';
import {attachAuthoritativePoRows} from '../api/_shared/po.js';

test('Fresh start waits for 4 a.m. and complete immediately preceding Shift 3',async()=>{
 const {report}=fixture();const config={mode:'live',start_date:'2026-10-03'};
 const opening={...report,date:'2026-10-02',shiftId:'shift-3',confirmed:true,pumpRows:report.pumpRows.map(r=>({...r,closing:r.opening,closingEntered:true})),tankRows:report.tankRows.map(r=>({...r,actualDip:1000}))};
 assert.equal(openingReady(opening,config),true);
 assert.equal(openingReady({...opening,confirmed:false},config),false);
 assert.equal(openingReady({...opening,date:'2026-10-01'},config),false);
 assert.equal(openingReady({...opening,pumpRows:opening.pumpRows.slice(1)},config),false);
 const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{data:opening}})})})})};
 assert.equal((await launchStatus(db,config,new Date('2026-10-03T03:59:59+08:00'))).ready,false);
 assert.equal((await launchStatus(db,config,new Date('2026-10-03T04:00:00+08:00'))).ready,true);
});

for(const confirmed of [false,true]) test(`Explicit cancelled CV disappears from report without altering counted cash (submitted=${confirmed})`,()=>{
 const {state,key}=fixture();const report=state.reports[key];
 const cv={id:'cancel-me',reference:'CV1',branch:'Liloan',date:report.date,shiftId:report.shiftId,amount:100};
 state.cvCashEvents=[cv];report.confirmed=confirmed;report.actualCashCounted=500;report.cashReviewState='checked';report.purchaseRows=[{id:'cv:cancel-me',source:'FuelTech CV',sourceVoucherId:'cancel-me',category:'OPEX',item:'Test',amount:100},{id:'manual',category:'OPEX',item:'Other',amount:20}];
 const expected=compute(report).expectedCash;
 state.sourceAlerts=[{id:'CV:cancel-me',reportKey:key}];
 const sources={pay:[],po:[],cvCashEvents:[],cvExclusions:[{id:'cancel-me',status:'cancelled'}]};
 reconcileSources(state,structuredClone(sources));
 assert.equal(report.purchaseRows.length,1);assert.equal(report.actualCashCounted,500);assert.equal(compute(report).expectedCash,expected+100);assert.equal(report.confirmed,confirmed);
 assert.equal(state.cvCashEvents.length,0);assert.equal(state.sourceAlerts.length,0);assert.ok(state.audit.some(a=>a.action==='cv-excluded-by-source-status'));
 const count=state.audit.length;reconcileSources(state,structuredClone(sources));assert.equal(state.audit.length,count);
});

test('Official owner totals and health use pilot deposit coverage without changing other station rules',()=>{
 const {report}=fixture();report.confirmed=true;report.actualCashCounted=500;report.pilot=true;report.pilotCashAwaitingDeposit=0;report.depositCoverage={id:'batch',status:'verified'};
 assert.equal(computeReportCash(report).pendingCashOnHand,0);
 assert.equal(compute(report).pendingCashOnHand,0);
 const health=buildDailyHealth({date:report.date,reportRows:[{report_key:`Liloan__${report.date}__shift-1`,data:report}]});
 assert.equal(health.stations.find(s=>s.branch==='Liloan').shifts[0].depositStatus,'Deposit Saved');
 const legacy={...report,pilot:false,oilSales:100};assert.equal(computeReportCash(legacy).pendingCashOnHand,100);
});

test('The existing admin view preserves pilot PO snapshots assigned by actual transaction time',async()=>{
 const rows=[{branch:'Liloan',report_date:'2026-10-03',report_key:'Liloan__2026-10-03__shift-2',data:{pilot:true,poRows:[{id:'actual-1301',amount:100}]}}];
 const db={from(){throw Error('Pilot snapshots must not be replaced using source shift labels');}};
 assert.deepEqual(await attachAuthoritativePoRows(db,rows),rows);
});
