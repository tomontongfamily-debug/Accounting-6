import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotDraftAlreadySaved } from '../src/pilot-draft-recovery.js';

const draft = () => ({ branch:'Liloan', date:'2026-10-07', shiftId:'shift-3', pilotRevision:45,
  clientSave:{clientId:'desktop',version:100,mutationId:'desktop:100'} });

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
