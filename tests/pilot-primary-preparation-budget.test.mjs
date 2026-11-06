import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PRIMARY_OCR_DOWNLOADS} from '../src/ocr-downloads.js';

test('a slow primary transfer does not spend the engine-start budget or duplicate download work',async t=>{
 const before={fetch:globalThis.fetch,caches:globalThis.caches,Worker:globalThis.Worker,document:globalThis.document};
 const saved=new Map(),requests=[],workers=[];let releaseCore,coreStarted,coreSignal,captureHasRegion=false;
 const held=new Promise(resolve=>{releaseCore=resolve;}),started=new Promise(resolve=>{coreStarted=resolve;});
 t.mock.timers.enable({apis:['setTimeout']});
 globalThis.caches={open:async()=>({match:async key=>saved.get(key)?.clone(),delete:async key=>saved.delete(key),put:async(key,response)=>saved.set(key,response.clone())})};
 globalThis.fetch=async(url,options)=>{
  requests.push(url);const file=Object.values(PRIMARY_OCR_DOWNLOADS).find(file=>url.endsWith('/'+file.path));assert.ok(file);
  if(file.path.startsWith('core/')){coreSignal=options.signal;coreStarted();await held;}
  return new Response(fs.readFileSync(new URL('../public/ocr/'+file.path,import.meta.url)));
 };
 globalThis.Worker=class{
  constructor(url){this.url=String(url);this.messages=[];this.terminated=false;workers.push(this);}
  postMessage(message){
   this.messages.push(message);
   queueMicrotask(()=>this.onmessage?.({data:message.action?{jobId:message.jobId,status:'resolve',data:undefined}:{id:message.id,gray:new Uint8Array([255]),analysis:{regions:captureHasRegion?[{x:0,y:0,width:1,height:1}]:[],components:[],mask:new Uint8Array([0])}}}));
  }
  terminate(){this.terminated=true;}
 };
 globalThis.document={createElement(){return{width:1,height:1,getContext(){return{putImageData(){},drawImage(){},getImageData(){return{data:new Uint8ClampedArray(4)};}};}};}};
 let session,unsubscribe;
 try{
  const reader=await import('../src/totalizer-ocr.js?slowPrimaryPreparation');
  const invalidations=[];
  unsubscribe=reader.subscribeTotalizerInvalidation(event=>invalidations.push(event));
  assert.equal(reader.TOTALIZER_TIMEOUT_MS,30000);
  const first=reader.prepareTotalizer(),second=reader.prepareTotalizer();await started;
  assert.equal(workers.filter(w=>w.url.includes('/worker.min.js')).length,0,'Engine starts only after verified downloads finish');
  captureHasRegion=true;
  const trace=[];
  const capture=reader.detectTotalizerResult({width:1,height:1,data:new Uint8ClampedArray(4)},{onTrace:event=>{trace.push(event);throw Error('diagnostic observer failure');}});
  // Flush the worker response so this capture is awaiting the shared download.
  for(let step=0;step<12;step++)await Promise.resolve();
  t.mock.timers.tick(30001);
  const outcome=await capture;assert.equal(outcome.reading,null);assert.equal(outcome.attempt.reason,'recognition-timeout');
  assert.equal(trace.at(-1).stage,'final');assert.equal(trace.at(-1).reason,'recognition-timeout');
  assert.deepEqual(invalidations,[{primary:true,advanced:true,reason:'recognition-timeout'}],'Expired foreground work invalidates readiness exactly once');
  assert.equal(coreSignal.aborted,false,'An expired capture must not abort automatic preparation for the next photo');
  t.mock.timers.tick(65000);
  releaseCore();const [a,b]=await Promise.all([first,second]);session=a;
  assert.equal(a,b);assert.equal(a.closed,false);assert.equal(requests.length,3);
  assert.equal(workers.filter(w=>w.url.includes('/worker.min.js')).length,1);
  assert.equal(await reader.prepareTotalizer(),a);assert.equal(requests.length,3);
 }finally{
  unsubscribe?.();
  session?.terminate();for(const worker of workers)worker.terminate();
  globalThis.fetch=before.fetch;globalThis.caches=before.caches;globalThis.Worker=before.Worker;globalThis.document=before.document;t.mock.timers.reset();
 }
});
