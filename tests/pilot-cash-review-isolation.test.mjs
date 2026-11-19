import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {compute} from '../src/accounting-engine.js';

function ready(){
 const f=fixture(),r=f.state.reports[f.key];
 Object.assign(r,{pilotRevision:8,pilotLastNonReadingRevision:8,pilotCashRevision:1,cashCountConfirmed:true,actualCashCounted:1000,cashDenominations:{1000:1},initialCashDenominations:{1000:1}});
 for(const row of r.pumpRows){
  const path='/api/pilot/photo?id='+row.id;f.state.photos[path]={branch:r.branch,reportKey:f.key,rowId:row.id};
  Object.assign(row,{closing:Number(row.opening)+10,closingEntered:true,readingConfirmed:true,photo_path:path});
 }
 return {...f,report:r};
}

test('cash check uses the latest saved report after another device edits it without replaying stale fields',async()=>{
 const f=ready(),stale=structuredClone(f.report);
 Object.assign(f.report,{pilotRevision:12,pilotLastNonReadingRevision:12,notes:'Latest manager note',cashierName:'Saved cashier'});
 stale.notes='Old note';stale.cashierName='Old cashier';stale.actualCashCounted=99999;
 stale.tankRows[0].actualDip=99999;stale.pumpRows[0].closing+=999;
 const out=await runAction(f.state,f.cashier,'/api/demo/cash-check',{report:stale});
 assert.equal(out.result.report.notes,'Latest manager note');assert.equal(out.result.report.cashierName,'Saved cashier');
 assert.equal(out.result.report.actualCashCounted,1000);
 assert.equal(out.result.report.pumpRows[0].closing,f.report.pumpRows[0].closing);
 assert.deepEqual(out.result.report.tankRows.map(r=>r.actualDip),f.report.tankRows.map(r=>r.actualDip));
 assert.equal(out.result.report.reviewedExpectedCash,compute(out.result.report).expectedCash);
 assert.equal(out.result.report.cashReviewState,'recount');
 await assert.rejects(runAction(f.state,f.cashier,'/api/reports/save',{report:stale}),/another device/);
});

test('recount survives unrelated saves but rejects changes to the saved cash count or reviewed total',async()=>{
 const f=ready(),checked=await runAction(f.state,f.cashier,'/api/demo/cash-check',{report:f.report});
 const stale=structuredClone(checked.result.report),state=checked.state,r=state.reports[f.key];
 Object.assign(r,{pilotRevision:r.pilotRevision+1,pilotLastNonReadingRevision:r.pilotRevision+1,notes:'Newer saved note'});
 const out=await runAction(state,f.cashier,'/api/demo/cash-recount',{report:stale,denominations:{1000:3}});
 assert.equal(out.result.report.actualCashCounted,3000);assert.equal(out.result.report.notes,'Newer saved note');
 assert.equal(out.result.report.initialCashDenominations[1000],1);
 await assert.rejects(runAction(out.state,f.cashier,'/api/demo/cash-recount',{report:stale,denominations:{1000:4}}),/reconciliation changed/);
 const changed=structuredClone(state);changed.reports[f.key].oilSales=100;
 await assert.rejects(runAction(changed,f.cashier,'/api/demo/cash-recount',{report:stale,denominations:{1000:3}}),/reconciliation changed/);
});

test('scoped cash check retains station and submitted-report locks',async()=>{
 const f=ready();
 await assert.rejects(runAction(f.state,{role:'Cashier',branch:'Mabolo'},'/api/demo/cash-check',{report:f.report}),/another station/);
 f.report.confirmed=true;
 await assert.rejects(runAction(f.state,f.cashier,'/api/demo/cash-check',{report:f.report}),/locked/);
});
