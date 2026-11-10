import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingPricePhotoTasks,midShiftPumpKey} from '../src/mid-shift-price-change.js';

test('manager finds earlier-shift work, skips blank/submitted/other-station tasks, and points to the first missing nozzle',()=>{
 const rows=[1,2].map(number=>({pump:'Pump 1',nozzle:'Premium'+number,product:'Premium',opening:100,closing:120,closingEntered:true}));
 const change={id:'price',product:'Premium',effectiveTime:'11:26',newPrice:91.9,readings:{[midShiftPumpKey(rows[0])]:110},readingPhotos:{[midShiftPumpKey(rows[0])]:{photo_path:'original-price-photo',readingConfirmed:true}}};
 const report={branch:'Barili',date:'2026-11-10',shiftId:'shift-1',pumpRows:rows,midShiftPriceChanges:[change,{id:'blank',newPrice:0,effectiveTime:'',readings:{},readingPhotos:{}}]};
 const reports={one:report,two:{...report,shiftId:'shift-2',midShiftPriceChanges:[report.midShiftPriceChanges[1]]},other:{...report,branch:'Mabolo'},old:{...report,date:'2026-11-09'},submitted:{...report,confirmed:true}};
 const snapshot=JSON.stringify(reports),tasks=pendingPricePhotoTasks(reports,'Barili','2026-11-10');
 assert.equal(tasks.length,1);assert.equal(tasks[0].reportKey,'Barili__2026-11-10__shift-1');assert.equal(tasks[0].done,1);assert.equal(tasks[0].total,2);assert.equal(tasks[0].nextNozzle,'Pump 1 Premium2');assert.equal(tasks[0].needsSetup,false);assert.equal(JSON.stringify(reports),snapshot);
});

test('all saved photos still need manager confirmation; invalid reading bounds and partial setup remain unfinished',()=>{
 const row={pump:'Pump 4',nozzle:'Premium',product:'Premium',opening:100,closing:120,closingEntered:true},key=midShiftPumpKey(row);
 const change={id:'price',product:'Premium',effectiveTime:'11:26',newPrice:91.9,readings:{[key]:110},readingPhotos:{[key]:{photo_path:'photo',readingConfirmed:true}}};
 const report={branch:'Barili',date:'2026-11-10',shiftId:'shift-1',pumpRows:[row],midShiftPriceChanges:[change]};
 const tasks=()=>pendingPricePhotoTasks([report],'Barili','2026-11-10');
 assert.equal(tasks()[0].done,1);assert.equal(tasks()[0].nextNozzle,'');
 change.readings[key]=121;assert.equal(tasks()[0].done,0);
 change.effectiveTime='';assert.equal(tasks()[0].needsSetup,true);
 change.confirmedAt='2026-11-10T05:00:00Z';assert.equal(tasks().length,0);
});
