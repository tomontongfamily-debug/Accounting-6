import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,openingPhotos,openingPhoto} from './pilot-fixture.mjs';
import {prepareStationRollout} from '../pilot/station-rollout.mjs';
import {ensureCurrentReports} from '../pilot/state.mjs';
import {runAction} from '../pilot/service.mjs';
import {withStationRollout} from '../src/station-rollout.js';

for(const branch of ['Mabolo','Arpili','Pondol','Barili','Moalboal'])test(branch+': shifts created before opening confirmation become available with the saved opening readings',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-05T12:29:00+08:00')});
 let {state}=fixture();state.mode='live';state.startDate='2026-10-03';
 const config=withStationRollout({mode:'live',start_date:state.startDate});prepareStationRollout(state,config);
 ensureCurrentReports(state);
 const setupKey=branch+'__2026-11-04__shift-3',shiftKey=branch+'__2026-11-05__shift-1';
 assert.equal(state.reports[shiftKey].baselineMissing,true);
 state.reports[shiftKey].pumpRows[1]={...state.reports[shiftKey].pumpRows[1],closing:501234,closingEntered:true,photo_path:'/saved/photo',readingConfirmed:true};
 state.photos['/saved/photo']={reportKey:shiftKey,rowId:state.reports[shiftKey].pumpRows[1].id,branch,file:'fixture'};
 state.reports[shiftKey].actualCashCounted="123";
 const before=structuredClone(state.reports[shiftKey]);
 // Preserve work already saved while this draft was waiting for setup.
 state.reports[shiftKey].notes='Keep saved shift work';
 state.reports[shiftKey].purchaseRows=[{id:'manual',amount:15,description:'Saved item'}];
 const opening=structuredClone(state.reports[setupKey]);opening.cashierName='Setup cashier';
 opening.pumpRows=opening.pumpRows.map((r,i)=>({...r,opening:500000+i*100}));
 opening.tankRows=opening.tankRows.map((r,i)=>({...r,opening:963+i*100}));opening.coke.beginning=46;opening.baselineConfirmed=true;
 state=await openingPhotos(state,opening);
 state=(await runAction(state,{role:'Cashier',branch},'/api/reports/save',{report:opening})).state;
 const confirmedSetup=structuredClone(state.reports[setupKey]),savedPhotos=structuredClone(state.photos);
 assert.equal(state.reports[shiftKey].baselineMissing,true,'reproduces the stale saved flag');
 ensureCurrentReports(state);
 const shift=state.reports[shiftKey];
 assert.equal(shift.baselineMissing,false);assert.equal(shift.baselineReady,true);assert.equal(shift.confirmed,false);
 assert.equal(shift.pumpRows[0].opening,500000);assert.equal(shift.tankRows[0].opening,963);assert.equal(shift.coke.beginning,46);
 assert.equal(shift.pumpRows[1].closing,before.pumpRows[1].closing);assert.equal(shift.actualCashCounted,before.actualCashCounted);
 assert.equal(shift.notes,'Keep saved shift work');assert.deepEqual(shift.purchaseRows,[{id:'manual',amount:15,description:'Saved item'}]);
 assert.deepEqual(state.reports[setupKey],confirmedSetup);assert.deepEqual(state.photos,savedPhotos);
 const load=await runAction(state,{role:'Cashier',branch},'/api/store/load',{});
 assert.equal(load.result.reportRows.find(r=>r.report_key===shiftKey).data.baselineMissing,false);
 state=await openingPhoto(state,shiftKey,shift.pumpRows[0].id,500025.5);
 assert.equal(state.reports[shiftKey].pumpRows[0].closing,500025.5);assert.equal(state.reports[shiftKey].pumpRows[0].readingConfirmed,true);
 const stable=structuredClone(state.reports);ensureCurrentReports(state);assert.deepEqual(state.reports,stable);
});

test('incomplete setup keeps Shift 1 locked and submitted history is untouched',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-05T12:29:00+08:00')});
 const {state}=fixture();state.mode='live';state.startDate='2026-10-03';prepareStationRollout(state,withStationRollout({mode:'live',start_date:state.startDate}));
 const history=structuredClone(state.reports['Liloan__2026-09-23__shift-1']);
 ensureCurrentReports(state);assert.equal(state.reports['Pondol__2026-11-05__shift-1'].baselineMissing,true);
 assert.deepEqual(state.reports['Liloan__2026-09-23__shift-1'],history);
});

