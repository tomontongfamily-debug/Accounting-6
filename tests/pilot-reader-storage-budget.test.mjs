import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

let version=0;
for(const kind of ['primary','advanced'])for(const blocked of ['open','match','body','put'])test(`${kind} preparation bypasses stalled cache ${blocked} without spending its download budget`,async t=>{
 const before={fetch:globalThis.fetch,caches:globalThis.caches};
 const reader=await import(`../src/ocr-downloads.js?storageBudget=${++version}`);
 const pinned=kind==='primary'?reader.PRIMARY_OCR_DOWNLOADS:reader.OCR_DOWNLOADS;
 const raw=new Map(Object.values(pinned).map(file=>[file.path,fs.readFileSync(new URL('../public/ocr/'+file.path,import.meta.url))]));
 const requests=[];let calls=0,allBlocked;
 const started=new Promise(resolve=>{allBlocked=resolve;});
 const hold=()=>{if(++calls===(blocked==='open'?1:3))allBlocked();return new Promise(()=>{});};
 const cache={
  match:async()=>blocked==='match'?hold():blocked==='body'?{arrayBuffer:hold}:undefined,
  put:async()=>blocked==='put'?hold():undefined,
  delete:async()=>true,
 };
 globalThis.caches={open:async()=>blocked==='open'?hold():cache};
 globalThis.fetch=async url=>{requests.push(url);const path=[...raw.keys()].find(path=>url.endsWith('/'+path));assert.ok(path);return new Response(raw.get(path));};
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  const prepare=()=>kind==='primary'?reader.preparePrimaryReaderFiles({timeoutMs:300000}):reader.prepareReaderFiles({timeoutMs:600000});
  const pending=prepare();await started;
  assert.equal(reader.readerPreparation().status,'preparing');
  t.mock.timers.tick(1501);
  const files=await pending;
  assert.equal(Object.keys(files).length,3);assert.equal(requests.length,3);
  assert.equal(reader.readerPreparation().status,'ready');
  assert.equal(reader.readerPreparation().savedForReuse,blocked==='match'||blocked==='body');
  if(blocked==='open'||blocked==='put'){
   const repeated=prepare();t.mock.timers.tick(1501);await repeated;
   assert.equal(requests.length,3,'Verified memory files remain usable when persistence is stuck');
  }
 }finally{globalThis.fetch=before.fetch;globalThis.caches=before.caches;t.mock.timers.reset();}
});
