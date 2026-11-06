import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {compute} from '../src/accounting-engine.js';
import {requiresZeroSalesConfirmation,zeroSalesReviewKey} from '../src/zero-sales.js';

async function ready(liters=0){
 const f=fixture();let r=f.state.reports[f.key];r.cashCountConfirmed=true;r.actualCashCounted=0;r.cashDenominations={1000:0};
 r.pumpRows.forEach(p=>{p.closing=Number(p.opening)+liters;p.closingEntered=true;p.readingConfirmed=true;p.photo_path='/api/pilot/photo?id='+p.id;f.state.photos[p.photo_path]={branch:r.branch,reportKey:f.key,rowId:p.id};});
 const checked=await runAction(f.state,f.cashier,'/api/demo/cash-check',{report:r});f.state=checked.state;f.report=checked.result.report;
 return f;
}
test('zero-sales submission needs a fresh explicit acknowledgement and records who confirmed it',async()=>{
 const f=await ready();assert.equal(compute(f.report).grossSales,0);
 const submit=report=>runAction(f.state,f.cashier,'/api/reports/save',{report,operation:'submit'});
 await assert.rejects(submit(f.report),/zero sales/);
 await assert.rejects(submit({...f.report,zeroSalesAcknowledged:true,zeroSalesReviewKey:'old-review'}),/zero sales/);
 const key=zeroSalesReviewKey(f.report,compute(f.report));
 const result=await submit({...f.report,zeroSalesAcknowledged:true,zeroSalesReviewKey:key});
 assert.equal(result.result.report.confirmed,true);assert.equal(result.result.report.actualCashCounted,0);
 assert.equal(result.result.report.zeroSalesConfirmation.cashierName,'Test cashier');
 assert.equal(result.result.report.zeroSalesConfirmation.reviewKey,key);
 assert.equal(result.state.audit.filter(a=>a.action==='zero-sales-confirmed').length,1);
 assert.equal(result.result.report.checkRequired,false);
});
test('positive sales with zero cash still do not require a zero-sales acknowledgement; opening setup is exempt',async()=>{
 const f=await ready(1);assert.equal(requiresZeroSalesConfirmation(f.report,compute(f.report)),false);
 const result=await runAction(f.state,f.cashier,'/api/reports/save',{report:f.report,operation:'submit'});
 assert.equal(result.result.report.confirmed,true);assert.equal(result.result.report.zeroSalesConfirmation,undefined);
 assert.equal(requiresZeroSalesConfirmation({baselineReport:true},{grossSales:0}),false);
});
test('a changed pump reading invalidates the previously reviewed zero-sales snapshot',async()=>{
 const f=await ready();const original=zeroSalesReviewKey(f.report,compute(f.report));
 const changed=structuredClone(f.report);changed.pumpRows[0].opening+=1;changed.pumpRows[0].closing+=1;
 assert.notEqual(zeroSalesReviewKey(changed,compute(changed)),original);
});
