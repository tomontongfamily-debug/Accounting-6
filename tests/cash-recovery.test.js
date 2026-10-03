import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverCashDraft} from '../src/cash-recovery.js';
test('Conflict recovery keeps entered quantities and the latest server fields',()=>{
 const latest={pilotRevision:20,notes:'newer saved note',cashDenominations:{100:1},pumpRows:[{photo_path:'latest-photo',closing:369671.42}]};
 const counts={1000:81,500:12,100:2,5:9},result=recoverCashDraft(latest,counts);
 assert.equal(result.pilotRevision,20);assert.equal(result.actualCashCounted,87245);assert.deepEqual(result.cashDenominations,counts);assert.equal(result.notes,latest.notes);assert.deepEqual(result.pumpRows,latest.pumpRows);assert.equal(latest.cashDenominations[100],1);
});
test('Conflict recovery cannot replace confirmed cash or submitted reports',()=>{
 for(const locked of [{cashCountConfirmed:true},{confirmed:true}]){const latest={...locked,actualCashCounted:50,cashDenominations:{50:1}};assert.equal(recoverCashDraft(latest,{1000:9}),latest);}
 const latest={cashReviewState:'recount'};assert.equal(recoverCashDraft(latest,null),latest);
});
