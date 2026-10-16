import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './pilot-fixture.mjs';
import {refreshPosReport} from '../pilot/pos-redemptions.mjs';
for(const status of ['verified','unavailable','disabled'])for(const confirmed of [false,true])test(`compact POS summaries enforce the same financial fields (${status}, confirmed=${confirmed})`,()=>{
 const {report}=fixture();
 const sync={status,startDate:report.date,verifiedAt:'2026-10-16T00:00:00Z',attemptedAt:'2026-10-16T00:00:00Z',rows:[{id:'one',date:report.date,shiftId:report.shiftId,type:'Cash',amount:37,quantity:0}],points:[{id:'two',date:report.date,shiftId:report.shiftId,points:13,voided:false}]};
 const stored=refreshPosReport({...report,confirmed},sync);
 const attempted={...stored,pointsIssued:999,pointsWithdrawn:888,deductions:{...stored.deductions,posRedemption:777}};
 const {rows:_rows,points:_points,...metadata}=sync;
 assert.deepEqual(refreshPosReport(attempted,{...metadata,_deferred:true}),refreshPosReport(attempted,sync));
});
