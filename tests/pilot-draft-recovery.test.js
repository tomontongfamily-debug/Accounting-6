import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotDraftAlreadySaved, recoverManagerPriceDraft } from '../src/pilot-draft-recovery.js';

const draft = () => ({ branch:'Liloan', date:'2026-10-07', shiftId:'shift-3', pilotRevision:45,
  clientSave:{clientId:'desktop',version:100,mutationId:'desktop:100'} });

test('an older empty manager form recovers saved products and photos without replacing cash or inventing missing nozzles',()=>{
 const local={...draft(),cashDenominations:{1000:3},notes:'Keep local note',midShiftPriceChanges:[{id:'blank',product:'Premium',effectiveTime:'',newPrice:0}]};
 const saved={...draft(),pilot:true,pilotRevision:50,pilotLastNonReadingRevision:48,midShiftBasePrices:{Diesel:94},midShiftPriceChanges:[{id:'diesel',product:'Diesel',effectiveTime:'15:07',newPrice:92,readings:{p1:10010},readingPhotos:{p1:{photo_path:'saved-photo',readingConfirmed:true}}}]};
 const recovered=recoverManagerPriceDraft(local,saved);
 assert.deepEqual(recovered.midShiftPriceChanges,saved.midShiftPriceChanges);assert.equal(recovered.pilotRevision,50);assert.equal(recovered.pilotLastNonReadingRevision,48);
 assert.deepEqual(recovered.cashDenominations,local.cashDenominations);assert.equal(recovered.notes,local.notes);assert.equal(recovered.midShiftPriceChanges[0].readingPhotos.p4,undefined);
 assert.equal(local.midShiftPriceChanges[0].id,'blank');
 for(const other of [{...saved,pilotRevision:45},{...saved,branch:'Barili'},{...saved,shiftId:'shift-2'},{...saved,midShiftPriceChanges:[]}])assert.equal(recoverManagerPriceDraft(local,other),local);
 const entered={...local,midShiftPriceChanges:[{id:'new-diesel',product:'Diesel',effectiveTime:'15:10',newPrice:''}]};assert.equal(recoverManagerPriceDraft(entered,saved),entered);
});

test('Reload recognizes an acknowledged cached draft despite its older pilot revision', () => {
  const local=draft(), saved={...local,pilot:true,pilotRevision:46};
  assert.equal(pilotDraftAlreadySaved(local,saved),true);
  assert.equal(pilotDraftAlreadySaved(local,{...saved,pilotRevision:50,clientSave:{...saved.clientSave,version:101}}),true);
});

test('New unsaved work and another device or shift cannot be discarded as acknowledged', () => {
  const local=draft(), saved={...local,pilot:true,pilotRevision:46};
  for(const other of [
    {...saved,clientSave:{...saved.clientSave,version:99}},
    {...saved,clientSave:{...saved.clientSave,clientId:'phone'}},
    {...saved,shiftId:'shift-2'},
    {...saved,pilot:false},
    {...saved,clientSave:undefined},
  ]) assert.equal(pilotDraftAlreadySaved(local,other),false);
  assert.equal(pilotDraftAlreadySaved(undefined,saved),false);
  assert.equal(pilotDraftAlreadySaved({...local,clientSave:{clientId:'desktop'}},saved),false);
});
