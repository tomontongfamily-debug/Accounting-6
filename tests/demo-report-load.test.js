import test from 'node:test';
import assert from 'node:assert/strict';
import {loadReportsWithDraftSync} from '../src/demo-report-load.js';

test('an unchanged offline queue does not download the report history twice',async()=>{
  let loads=0;const saved={reports:{one:{notes:'saved'}}};
  const result=await loadReportsWithDraftSync({load:async()=>{loads++;return saved;},flush:async store=>{assert.equal(store,saved);return false;}});
  assert.equal(loads,1);assert.equal(result.onlineStore,saved);assert.equal(result.draftSyncError,null);
});

for(const changed of [true,undefined])test(`successful or unspecified uploads refresh authoritative reports (${changed})`,async()=>{
  let loads=0;
  const result=await loadReportsWithDraftSync({load:async()=>({revision:++loads}),flush:async()=>changed});
  assert.equal(loads,2);assert.equal(result.onlineStore.revision,2);
});

test('a rejected draft still reloads any earlier committed uploads and preserves the error',async()=>{
  let loads=0;const error=Object.assign(new Error('Another draft needs review.'),{status:409});
  const result=await loadReportsWithDraftSync({load:async()=>({revision:++loads}),flush:async()=>{throw error;}});
  assert.equal(loads,2);assert.equal(result.onlineStore.revision,2);assert.equal(result.draftSyncError,error);
});

test('an expired session stops loading and no uploader loads history once',async()=>{
  let loads=0;const load=async()=>({revision:++loads});
  for(const status of [401,403])await assert.rejects(loadReportsWithDraftSync({load,flush:async()=>{throw Object.assign(new Error('Sign in again.'),{status});}}),error=>error.status===status);
  const result=await loadReportsWithDraftSync({load});assert.equal(result.onlineStore.revision,3);assert.equal(loads,3);
});
