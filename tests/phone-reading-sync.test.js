import test from 'node:test';
import assert from 'node:assert/strict';
import {mergePhoneReadings} from '../src/phone-reading-sync.js';
const report=()=>({branch:'Liloan',date:'2026-10-03',shiftId:'shift-1',pilotRevision:4,pilotLastNonReadingRevision:4,pumpRows:[{pump:'Pump 1',nozzle:'Premium',product:'Premium',readingRevision:0,closing:''}],cashDenominations:{500:12},tankRows:[{actualDip:123}],notes:'Unsaved local note'});
test('Phone evidence merges into a dirty desktop while preserving cash and tank inputs',()=>{
 const local=report(),remote={...report(),pilotRevision:7,notes:'Old server note',cashDenominations:{},tankRows:[{actualDip:0}],pumpRows:[{...local.pumpRows[0],readingRevision:3,closing:439931.31,photo_path:'/api/pilot/photo?id=test',readingConfirmed:true}]};
 const next=mergePhoneReadings(local,remote);
 assert.equal(next.pumpRows[0].closing,439931.31);assert.equal(next.pumpRows[0].readingConfirmed,true);assert.equal(next.pilotRevision,7);
 assert.deepEqual(next.cashDenominations,local.cashDenominations);assert.deepEqual(next.tankRows,local.tankRows);assert.equal(next.notes,local.notes);
 assert.equal(mergePhoneReadings(next,remote),next);
});
test('Another desktop edit does not silently authorize overwriting its fields',()=>{
 const local=report(),remote={...report(),pilotRevision:7,pilotLastNonReadingRevision:6,pumpRows:[{...local.pumpRows[0],readingRevision:3,closing:105}]};
 const next=mergePhoneReadings(local,remote);assert.equal(next.pilotRevision,4);assert.equal(next.pumpRows[0].closing,105);assert.equal(next.notes,local.notes);
});
test('Late responses cannot replace newer reading or cash confirmations',()=>{
 const local={...report(),pilotRevision:10,pilotCashRevision:2,cashCountConfirmed:true,actualCashCounted:300,cashReviewState:'final',recountRequired:false};local.pumpRows[0].readingRevision=8;
 const older={...report(),pilotRevision:9,pilotCashRevision:1,cashCountConfirmed:true,actualCashCounted:100,cashReviewState:'recount',recountRequired:true};older.pumpRows[0].readingRevision=6;
 assert.equal(mergePhoneReadings(local,older),local);
 assert.equal(mergePhoneReadings(local,{...older,date:'2026-10-02'}),local);
});
test('A submitted shift or a saved locked cash confirmation remains locked',()=>{
 const local=report(),saved={...report(),pilotRevision:5,cashCountConfirmed:true,actualCashCounted:200,cashDenominations:{200:1},pilotCashRevision:1};
 const next=mergePhoneReadings(local,saved);assert.equal(next.cashCountConfirmed,true);assert.equal(next.actualCashCounted,200);assert.deepEqual(next.cashDenominations,{200:1});
 const submitted={...saved,confirmed:true};assert.equal(mergePhoneReadings(local,submitted),submitted);
});
