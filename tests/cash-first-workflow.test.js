import test from 'node:test';
import assert from 'node:assert/strict';
import {needsCashEntry,initialCashierStep,withCashEntryDraft,readCashEntryDraft,saveCashEntryDraft,clearCashEntryDraft} from '../src/cash-first-workflow.js';

const report=()=>({branch:'Liloan',date:'2026-11-03',shiftId:'shift-1',cashCountConfirmed:false,cashDenominations:{},pumpRows:[{photo_path:'saved-photo'}],notes:'Saved note'});
const config={mode:'live',start_date:'2026-10-03'};
test('unfinished cash is always first even when the device saved a later wizard step',()=>{
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
test('typing or refreshing cash quantities never changes financial totals or saved pump evidence',()=>{
  const saved=report(),before=structuredClone(saved);const counts={1000:'2',500:'1',1:'0'};
  const draft=withCashEntryDraft(saved,counts);assert.deepEqual(draft.cashDenominations,counts);
  assert.equal(draft.cashCountConfirmed,false);assert.equal(draft.actualCashCounted,undefined);
  assert.deepEqual(draft.pumpRows,saved.pumpRows);assert.equal(draft.notes,saved.notes);assert.deepEqual(saved,before);
});
test('a confirmed count from another device or submitted report wins over the local draft',()=>{
  for(const lock of [{cashCountConfirmed:true},{confirmed:true}]){const saved={...report(),...lock,actualCashCounted:500,cashDenominations:{500:1}};assert.equal(withCashEntryDraft(saved,{1000:9}),saved);assert.equal(readCashEntryDraft(null,config,saved),null);}
});
test('pending cash survives a reload and is isolated by station, shift, date and accounting version',()=>{
  const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  const first=report(),counts={1000:'2'};saveCashEntryDraft(storage,config,first,counts);assert.deepEqual(readCashEntryDraft(storage,config,first),counts);
  for(const other of [{...first,shiftId:'shift-2'},{...first,date:'2026-11-04'},{...first,branch:'Mabolo'}])assert.equal(readCashEntryDraft(storage,config,other),null);
  assert.equal(readCashEntryDraft(storage,{...config,mode:'shadow'},first),null);
  clearCashEntryDraft(storage,config,first);assert.equal(readCashEntryDraft(storage,config,first),null);
});
test('blocked or malformed device storage does not stop the cashier from using the current page',()=>{
  assert.doesNotThrow(()=>saveCashEntryDraft(null,config,report(),{1000:'1'}));
  assert.equal(readCashEntryDraft(null,config,report()),null);
  assert.equal(readCashEntryDraft({getItem:()=>'{bad'},config,report()),null);
  assert.doesNotThrow(()=>clearCashEntryDraft(null,config,report()));
});
