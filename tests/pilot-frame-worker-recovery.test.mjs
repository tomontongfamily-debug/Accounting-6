import test from 'node:test';
import assert from 'node:assert/strict';

test('a transient frame worker load failure is retryable and a fresh worker can recover',async()=>{
 const before=globalThis.Worker,workers=[];
 globalThis.Worker=class{
  constructor(){workers.push(this);}
  postMessage(message){this.message=message;}
  terminate(){this.terminated=true;}
 };
 try{
  const reader=await import('../src/totalizer-frame-client.js?transientRecovery');
  const first=reader.analyzeTotalizerFrame(new Uint8ClampedArray(4),1,1);
  workers[0].onerror({preventDefault(){}});
  await assert.rejects(first,error=>error.reason==='worker-failed');
  assert.equal(workers[0].terminated,true);
  const second=reader.analyzeTotalizerFrame(new Uint8ClampedArray(4),1,1);
  assert.equal(workers.length,2);
  workers[1].onmessage({data:{id:workers[1].message.id,gray:new Uint8Array([255]),analysis:{regions:[]}}});
  assert.equal((await second).analysis.regions.length,0);
  reader.cancelTotalizerFrame();
 }finally{globalThis.Worker=before;}
});

test('a browser without worker capability reports a genuine unsupported error',async()=>{
 const before=globalThis.Worker;globalThis.Worker=undefined;
 try{
  const reader=await import('../src/totalizer-frame-client.js?unsupportedRecovery');
  await assert.rejects(reader.analyzeTotalizerFrame(new Uint8ClampedArray(4),1,1),error=>error.reason==='unsupported-browser');
 }finally{globalThis.Worker=before;}
});
