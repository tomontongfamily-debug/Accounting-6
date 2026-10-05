import test from 'node:test';
import assert from 'node:assert/strict';
import {createStoreRefreshQueue, refreshStore} from '../src/store-refresh.js';

test('Empty or rejected offline queues need only one history download', async () => {
  let loads = 0;
  const store = {reports: {saved: {confirmed: true}}};
  assert.equal(await refreshStore(async () => { loads++; return store; }, async () => false), store);
  assert.equal(loads, 1);
});

test('Successful offline uploads reload the authoritative totals', async () => {
  const calls = [];
  const result = await refreshStore(async () => { calls.push('load'); return calls.length; }, async () => { calls.push('upload'); return true; });
  assert.deepEqual(calls, ['load', 'upload', 'load']);
  assert.equal(result, 3);
});

test('Focus and realtime bursts during a slow history load are serialized and coalesced', async () => {
  const releases = [];
  const calls = [];
  let notifySecondStart;
  const secondStarted = new Promise(resolve => { notifySecondStart = resolve; });
  let concurrent = 0;
  const queue = createStoreRefreshQueue(async silent => {
    concurrent++;
    assert.equal(concurrent, 1);
    calls.push(silent);
    if (calls.length === 2) notifySecondStart();
    await new Promise(resolve => releases.push(resolve));
    concurrent--;
  });
  const initial = queue.refresh();
  await Promise.resolve();
  for (let i = 0; i < 10; i++) assert.equal(queue.refresh(true), initial);
  releases.shift()();
  await secondStarted;
  assert.deepEqual(calls, [false, true]);
  releases.shift()();
  await initial;
  assert.equal(concurrent, 0);
});

test('Leaving the role or station cancels any queued refresh', async () => {
  let release;
  let calls = 0;
  const queue = createStoreRefreshQueue(async () => { calls++; await new Promise(resolve => { release = resolve; }); });
  const pending = queue.refresh();
  await Promise.resolve();
  queue.refresh(true);
  queue.stop();
  release();
  await pending;
  await queue.refresh();
  assert.equal(calls, 1);
});

test('A failed refresh releases the queue so the next attempt can recover', async () => {
  let calls = 0;
  const queue = createStoreRefreshQueue(async () => { if (!calls++) throw Error('network'); });
  await assert.rejects(queue.refresh(), /network/);
  await queue.refresh();
  assert.equal(calls, 2);
});
