import test from 'node:test';
import assert from 'node:assert/strict';
import {needsPriceReentry,priceReviewKey,priceReviewError,requestPriceReview,midShiftPriceReviewContext} from '../src/price-confirmation.js';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
const context={branch:'Liloan',date:'2026-09-23',coverage:'Daily',shiftId:'daily',product:'Regular',previousPrice:65,newPrice:650};
const proof=c=>({reviewKey:priceReviewKey(c),typedPrice:String(c.newPrice)});

test('price re-entry triggers at 20 percent in either direction and for first setup',()=>{
 for(const [previous,next,expected] of [[100,119.99,false],[100,120,true],[100,80,true],[100,80.01,false],[65,650,true],[0,65,true],[undefined,65,true],[65,65,false]])assert.equal(needsPriceReentry(previous,next),expected);
});
test('large price confirmation shows full context and requires independently typed exact price',()=>{
 const shown=[];const review=requestPriceReview(context,{confirm:message=>{shown.push(message);return true;},prompt:(message,initial)=>{shown.push(message);assert.equal(initial,'');return'650.00';}});
 assert.equal(priceReviewError(context,review),'');
 assert.match(shown[0],/Liloan.*\nProduct: Regular/);assert.match(shown[0],/2026-09-23/);assert.match(shown[0],/All shifts/);assert.match(shown[0],/₱65.00 → ₱650.00/);
 assert.throws(()=>requestPriceReview(context,{confirm:()=>true,prompt:()=> '65'}),/re-entering/);
 assert.equal(requestPriceReview(context,{confirm:()=>false,prompt:()=>assert.fail('No prompt after cancel')}),null);
 assert.equal(requestPriceReview(context,{confirm:()=>true,prompt:()=>null}),null);
});
test('small price changes use one confirmation and no re-entry',()=>{
 const c={...context,newPrice:66};let confirms=0;
 const review=requestPriceReview(c,{confirm:()=>{confirms++;return true;},prompt:()=>assert.fail('No re-entry for small change')});
 assert.equal(confirms,1);assert.equal(priceReviewError(c,review),'');
});
test('changing price, branch, date or shift invalidates a previous confirmation',()=>{
 const c={...context,coverage:'Shift',shiftId:'shift-1'};
 for(const change of [{newPrice:700},{previousPrice:66},{branch:'Arpili'},{date:'2026-09-24'},{shiftId:'shift-2'}])assert.match(priceReviewError({...c,...change},proof(c)),/changed/);
});
test('server rejects a large daily price change without matching re-entry and preserves originals',async()=>{
 const {state,manager}=fixture(),before=structuredClone(state);
 const input={branch:context.branch,date:context.date,coverage:'Daily',pricePatch:{Regular:650}};
 await assert.rejects(runAction(state,manager,'/api/prices/save',input),/re-entering/);
 await assert.rejects(runAction(state,manager,'/api/prices/save',{...input,priceReview:{Regular:{...proof(context),typedPrice:'65'}}}),/re-entering/);
 assert.deepEqual(state,before);
 const saved=await runAction(state,manager,'/api/prices/save',{...input,priceReview:{Regular:proof(context)}});
 assert.equal(saved.result.prices.Regular,650);assert.equal(saved.result.prices.Premium,70);
 assert.deepEqual(saved.state.audit.at(-1).priceReview.Regular,proof(context));
 const stale={...context,previousPrice:64};await assert.rejects(runAction(state,manager,'/api/prices/save',{...input,priceReview:{Regular:proof(stale)}}),/changed/);
});
test('mid-shift confirmation uses the prior confirmed price in overnight time order',()=>{
 const report={branch:'Liloan',date:'2026-11-06',shiftId:'shift-3',prices:{Regular:65},midShiftBasePrices:{Regular:65},midShiftPriceChanges:[{id:'earlier',product:'Regular',effectiveTime:'23:00',newPrice:70,confirmedAt:'saved'},{id:'later',product:'Regular',effectiveTime:'01:00',newPrice:700}]};
 const change=report.midShiftPriceChanges[1],c=midShiftPriceReviewContext(report,change);
 assert.equal(c.previousPrice,70);assert.equal(c.effectiveTime,'01:00');assert.equal(c.shiftId,'shift-3');assert.equal(c.changeId,'later');
 assert.match(priceReviewError(c),/re-entering/);assert.equal(priceReviewError(c,proof(c)),'');
});
test('server cannot confirm a large mid-shift change through either confirmation route without review',async()=>{
 const {state,report,key,manager}=fixture();
 const change={id:'price',product:'Regular',effectiveTime:'09:00',newPrice:650,photoRequired:false,readings:{},readingPhotos:{}};
 report.pumpRows.forEach(row=>{row.closing=Number(row.opening)+10;row.closingEntered=true;if(row.product==='Regular')change.readings[row.id]=Number(row.opening)+5;});
 report.midShiftPriceChanges=[change];report.midShiftBasePrices={...report.prices};
 state.reports[key]=report;
 await assert.rejects(runAction(state,manager,'/api/demo/midshift-confirm',{reportKey:key,changeId:'price'}),/re-entering/);
 await assert.rejects(runAction(state,manager,'/api/reports/save',{report:{...report,midShiftPriceChanges:[{...change,confirmedAt:'requested'}]}}),/re-entering/);
 const c=midShiftPriceReviewContext(report,change);
 const out=await runAction(state,manager,'/api/demo/midshift-confirm',{reportKey:key,changeId:'price',priceReview:proof(c)});
 assert.ok(out.result.report.midShiftPriceChanges[0].confirmedAt);
});
