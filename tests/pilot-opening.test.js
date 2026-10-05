import test from 'node:test';
import assert from 'node:assert/strict';
import { createReport } from '../src/accounting-engine.js';
import { openingReady, pilotOpeningSlot } from '../src/pilot-opening.js';

const config={start_date:'2026-10-03'};
const baseline=()=>{
  const r=createReport('Liloan','2026-10-02',{},'shift-3');r.confirmed=true;r.baselineConfirmed=true;
  r.pumpRows=r.pumpRows.map((row,i)=>({...row,opening:1000+i,closing:1001+i,closingEntered:true}));
  r.tankRows=r.tankRows.map(row=>({...row,actualDip:1000}));return r;
};

test('The configured October fresh start recognizes its submitted Shift 3 without legacy opening flags',()=>{
  assert.deepEqual(pilotOpeningSlot(config),{date:'2026-10-02',shiftId:'shift-3'});
  const r=baseline();assert.equal(r.openingSetupComplete,undefined);assert.equal(r.baselineReport,undefined);
  assert.equal(openingReady(r,config),true);
  assert.equal(openingReady({...r,date:'2026-07-29',openingSetupComplete:true},config),false);
  assert.equal(openingReady({...r,shiftId:'shift-2'},config),false);
  assert.equal(openingReady({...r,branch:'Mabolo'},config),false);
});

test('An incomplete, duplicated or unsubmitted fresh-start opening cannot unlock desktop reporting',()=>{
  const r=baseline();
  for(const incomplete of [undefined,{...r,confirmed:false},{...r,pumpRows:r.pumpRows.slice(1)},{...r,pumpRows:[...r.pumpRows,r.pumpRows[0]]},{...r,tankRows:r.tankRows.slice(1)},{...r,pumpRows:r.pumpRows.map((row,i)=>i?row:{...row,closingEntered:false})}])assert.equal(openingReady(incomplete,config),false);
});

test('Opening dates follow the configured start across month and year boundaries',()=>{
  assert.deepEqual(pilotOpeningSlot({start_date:'2027-01-01'}),{date:'2026-12-31',shiftId:'shift-3'});
  for(const start_date of [undefined,'','2026-02-30','July 29'])assert.throws(()=>pilotOpeningSlot({start_date}),/Invalid pilot start date/);
});
