import test from 'node:test';
import assert from 'node:assert/strict';
import {needsCashEntry,initialCashierStep} from '../src/cash-first-workflow.js';

const report=()=>({branch:'Liloan',date:'2026-11-03',shiftId:'shift-1',cashCountConfirmed:false});

test('unfinished cash is always first on desktop even when the device saved a later wizard step',()=>{
  for(const step of [0,1,2,3,4,5,undefined,'bad'])assert.equal(initialCashierStep(report(),step),0);
  assert.equal(needsCashEntry(report()),true);
});

test('confirmed counts can resume later work; submitted and opening reports retain their existing flow',()=>{
  const confirmed={...report(),cashCountConfirmed:true};
  assert.equal(initialCashierStep(confirmed,3),3);assert.equal(initialCashierStep(confirmed,5),4);
  assert.equal(initialCashierStep({...report(),confirmed:true},0),4);
  for(const flag of ['baselineMissing','baselineReport']){assert.equal(initialCashierStep({...report(),[flag]:true},0),1);assert.equal(needsCashEntry({...report(),[flag]:true}),false);}
  assert.equal(needsCashEntry(null),false);
});
