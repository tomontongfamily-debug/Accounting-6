import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {compute} from '../src/accounting-engine.js';
import {cashNeedsRecount,isHighShortage,HIGH_SHORTAGE_MESSAGE,reportIssues} from '../pilot/domain.mjs';
import {validateSubmission} from '../api/reports/save.js';

function ready(cash=1000){
 const f=fixture(),r=f.state.reports[f.key];
 Object.assign(r,{cashCountConfirmed:true,actualCashCounted:cash,cashDenominations:{1000:Math.floor(cash/1000),500:Math.floor(cash%1000/500)},initialCashDenominations:{1000:Math.floor(cash/1000),500:Math.floor(cash%1000/500)},cashReviewState:'final',pilot:true});
 for(const row of r.pumpRows){Object.assign(row,{closing:Number(row.opening),closingEntered:true,closingEntrySource:'cashier',readingConfirmed:true,photo_path:'/api/pilot/photo?id='+row.id});f.state.photos[row.photo_path]={branch:r.branch,reportKey:f.key,rowId:row.id};}
 const pump=r.pumpRows.find(row=>row.product==='Regular');pump.closing=Number(pump.opening)+100;
 r.reviewedExpectedCash=compute(r).expectedCash;
 return {...f,report:r};
}
test('shortage boundaries change to three thousand without changing overage review or exposing amounts in the message',()=>{
 for(const [variance,blocked] of [[-1500,false],[-1500.01,false],[-2999.99,false],[-3000,false],[-3000.01,true],[101,false]])assert.equal(isHighShortage(variance),blocked);
 assert.equal(cashNeedsRecount(3500,6500),false);assert.equal(cashNeedsRecount(3499.99,6500),true);assert.equal(cashNeedsRecount(6601,6500),true);
 assert.equal(reportIssues({pumpRows:[]},-3000).length,0);assert.equal(reportIssues({pumpRows:[]},-3000.01).length,1);
 assert.doesNotMatch(HIGH_SHORTAGE_MESSAGE,/[0-9₱]/);
});
test('a direct submission cannot bypass the limit, and the draft and original count survive rejection',async()=>{
 const f=ready(),before=structuredClone(f.state);
 await assert.rejects(runAction(f.state,f.cashier,'/api/reports/save',{report:{...f.report,actualCashCounted:6500},operation:'submit'}),error=>error.message===HIGH_SHORTAGE_MESSAGE);
 assert.deepEqual(f.state,before);assert.equal(f.state.reports[f.key].confirmed,false);
 const saved=await runAction(f.state,f.cashier,'/api/reports/save',{report:{...f.report,notes:'Manager checking the supporting records'},operation:'save'});
 assert.equal(saved.result.report.confirmed,false);assert.equal(saved.result.report.actualCashCounted,1000);
 const recounted=await runAction(saved.state,f.cashier,'/api/demo/cash-recount',{report:saved.result.report,denominations:{1000:4}});
 assert.equal(recounted.result.report.actualCashCounted,4000);assert.equal(recounted.result.report.initialCashDenominations[1000],1);
 const sent=await runAction(recounted.state,f.cashier,'/api/reports/save',{report:recounted.result.report,operation:'submit'});
 assert.equal(sent.result.report.confirmed,true);
});
test('exact boundary submits, a cent beyond does not, and baseline setup is not affected',async()=>{
 for(const [cash,allowed] of [[3500,true],[3499.99,false]]){
  const f=ready(cash);
  if(allowed)assert.equal((await runAction(f.state,f.cashier,'/api/reports/save',{report:f.report,operation:'submit'})).result.report.confirmed,true);
  else await assert.rejects(runAction(f.state,f.cashier,'/api/reports/save',{report:f.report,operation:'submit'}),error=>error.message===HIGH_SHORTAGE_MESSAGE);
 }
});
test('legacy submission validation enforces the same hidden-amount rule',()=>{
 const f=ready();f.report.tankRows.forEach(row=>row.actualDip=1000);
 assert.equal(validateSubmission(f.report),HIGH_SHORTAGE_MESSAGE);
 f.report.actualCashCounted=3500;assert.equal(validateSubmission(f.report),'');
});
test('a newer authoritative price cannot bypass the shortage check using an older balanced client report',async()=>{
 const f=ready(6500);assert.equal(compute(f.report).cashVariance,0);
 f.state.priceBook.Liloan[f.report.date]={Premium:70,Regular:100,Diesel:60};
 await assert.rejects(runAction(f.state,f.cashier,'/api/reports/save',{report:f.report,operation:'submit'}),error=>error.message===HIGH_SHORTAGE_MESSAGE);
 assert.equal(f.state.reports[f.key].confirmed,false);
});
