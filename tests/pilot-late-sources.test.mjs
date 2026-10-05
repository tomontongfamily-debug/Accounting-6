import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './pilot-fixture.mjs';
import {normalizeSources,LILOAN_STATION_ID} from '../pilot/integrations.mjs';
import {reconcileSources} from '../pilot/state.mjs';
import {compute,reportKey} from '../src/accounting-engine.js';
import {runAction} from '../pilot/service.mjs';

const voucher={id:'cv-yesterday',ref:'CV1',station:'liloan',payment_method:'cash',status:'approved',created_at:'2026-09-23T14:00:00+08:00',decided_at:'2026-09-24T10:00:00+08:00',amount:500,category:{name:'OPEX'},purpose:'Supplies'};
const permute=value=>Array.isArray(value)?value.map(permute):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,v])=>[key,permute(v)])):value;

test('A CV approved the next day updates only its created shift, even after submission',()=>{
 const {state,report}=fixture();
 const yesterday={...structuredClone(report),shiftId:'shift-2',confirmed:true,actualCashCounted:1000,cashCountConfirmed:true,cashDenominations:{1000:1},deposits:[{id:'verified',amount:1000,verified:true}],depositCoverage:{id:'verified',status:'verified'}};
 const today={...structuredClone(report),date:'2026-09-24'};
 const key=reportKey(yesterday.branch,yesterday.date,yesterday.shiftId),todayKey=reportKey(today.branch,today.date,today.shiftId);
 state.reports[key]=yesterday;state.reports[todayKey]=today;
 const physical=structuredClone({pumpRows:yesterday.pumpRows,tankRows:yesterday.tankRows,cashDenominations:yesterday.cashDenominations,deposits:yesterday.deposits,depositCoverage:yesterday.depositCoverage,confirmedAt:yesterday.confirmedAt});
 const expected=compute(yesterday).expectedCash;
 const sources=normalizeSources({cv:[voucher]},state.startDate);
 reconcileSources(state,structuredClone(sources));
 assert.equal(yesterday.purchaseRows.length,1);assert.equal(yesterday.purchaseRows[0].amount,500);
 assert.equal(compute(yesterday).expectedCash,expected-500);assert.equal(yesterday.actualCashCounted,1000);assert.equal(yesterday.confirmed,true);
 assert.deepEqual({pumpRows:yesterday.pumpRows,tankRows:yesterday.tankRows,cashDenominations:yesterday.cashDenominations,deposits:yesterday.deposits,depositCoverage:yesterday.depositCoverage,confirmedAt:yesterday.confirmedAt},physical);
 assert.equal(today.purchaseRows.length,0);assert.ok(state.audit.some(a=>a.action==='source-shift-reconciled'&&a.reportKey===key));
 const count=state.audit.length;
 // Postgres JSONB reorders object keys; reloading must not create more revisions.
 const persisted=permute(JSON.parse(JSON.stringify(state)));
 reconcileSources(persisted,structuredClone(sources));assert.equal(persisted.audit.length,count);
});

test('Creation-time migration removes a CV from the approval shift without duplicating it',()=>{
 const {state,report,key}=fixture();
 const sources=normalizeSources({cv:[voucher]},state.startDate),next=sources.cvCashEvents[0];
 const old={...next,date:report.date,shiftId:report.shiftId};delete old.assignmentBasis;
 state.cvCashEvents=[old];state.reports[key].confirmed=true;
 state.reports[key].purchaseRows=[{id:'cv:'+old.id,sourceVoucherId:old.id,source:'FuelTech CV',category:'OPEX',item:old.item,amount:500}];
 const target={...structuredClone(report),shiftId:'shift-2',confirmed:true,purchaseRows:[]};state.reports[reportKey(target.branch,target.date,target.shiftId)]=target;
 reconcileSources(state,sources);
 assert.equal(state.reports[key].purchaseRows.length,0);assert.equal(target.purchaseRows.length,1);assert.equal(state.cvCashEvents.length,1);assert.deepEqual(state.sourceAlerts,[]);
});

test('CV created before cutover is removed from a later approval shift, without rewriting history',()=>{
 const {state,report,key}=fixture();report.confirmed=true;state.reports[key]=report;
 const old={...voucher,created_at:'2026-09-22T14:00:00+08:00'};
 const sources=normalizeSources({cv:[old]},state.startDate);
 state.cvCashEvents=[{id:old.id,branch:'Liloan',date:report.date,shiftId:report.shiftId,amount:500}];
 report.purchaseRows=[{source:'FuelTech CV',sourceVoucherId:old.id,amount:500}];
 const history=structuredClone(state.reports['Liloan__2026-09-22__shift-3']);
 reconcileSources(state,sources);assert.equal(report.purchaseRows.length,0);assert.equal(state.cvCashEvents.length,0);assert.deepEqual(state.reports['Liloan__2026-09-22__shift-3'],history);
});

test('Delayed paid notifications update the payment shift rather than arrival time or checkout labels',()=>{
 const {state,report,key}=fixture();report.confirmed=true;report.actualCashCounted=500;state.reports[key]=report;
 const pay=[['noon-100',100,'12:00:00'],['noon-83',83,'12:59:59'],['cutoff',200,'13:00:00']].map(([id,base_amount,time])=>({id,base_amount,station_id:LILOAN_STATION_ID,status:'PAID',paid_at:`2026-09-23T${time}+08:00`,business_date:'2026-09-24',shift:'Shift 3'}));
 const expected=compute(report).expectedCash;
 reconcileSources(state,normalizeSources({pay},state.startDate));
 assert.equal(report.deductions.gcash,183);assert.equal(report.onlinePay.count,2);assert.equal(report.actualCashCounted,500);assert.equal(compute(report).expectedCash,expected-183);
 assert.equal(state.pay.find(row=>row.id==='cutoff').shiftId,'shift-2');
 const count=state.audit.length;reconcileSources(state,normalizeSources({pay},state.startDate));assert.equal(state.audit.length,count);
 const saved=structuredClone(report.deductions);
 reconcileSources(state,normalizeSources({pay:[]},state.startDate));assert.deepEqual(report.deductions,saved);assert.equal(state.sourceAlerts.length,2);
});

test('Replacing a pump photo atomically clears confirmation and checks the nozzle revision',async()=>{
 const {state,report,key,cashier}=fixture(),row=report.pumpRows[0];
 state.reports[key]=report;
 Object.assign(row,{readingConfirmed:true,closingEntered:true,closing:Number(row.opening)+1,readingRevision:2,photo_path:'old'});
 report.cashReviewState='checked';
 let uploads=0;
 const input={reportKey:key,rowId:row.id,replaceReading:true,revision:2,data:'data:image/jpeg;base64,/9j/2Q=='};
 const options={uploadPhoto:async()=>{uploads++;}};
 const out=await runAction(state,cashier,'/api/demo/photo',input,options),saved=out.state.reports[key].pumpRows[0];
 assert.equal(saved.readingConfirmed,false);assert.equal(saved.closing,'');assert.equal(saved.photo_path,out.result.photo_path);assert.equal(out.result.readingRevision,3);assert.equal(out.state.reports[key].cashReviewState,'');
 await assert.rejects(runAction(out.state,cashier,'/api/demo/photo',input,options),/another device/);assert.equal(uploads,1);
});
