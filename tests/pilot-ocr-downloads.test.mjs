import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const raw=new Map(['neural/english-mobile.onnx','neural/characters.json','ort/ort-wasm-simd-threaded.wasm'].map(file=>[file,fs.readFileSync(new URL('../public/ocr/'+file,import.meta.url))]));
let moduleId=0;
for(const storage of ['available','denied','quota'])test(`reader files are verified, shared and reusable with storage ${storage}`,async()=>{
 const before={fetch:globalThis.fetch,caches:globalThis.caches},saved=new Map(),requests=[];
 globalThis.caches={open:async()=>{
  if(storage==='denied')throw Error('Private storage denied');
  return{match:async key=>saved.get(key)?.clone(),delete:async key=>saved.delete(key),put:async(key,response)=>{
   if(storage==='quota')throw Error('Quota exceeded');saved.set(key,response.clone());
  }};
 }};
 globalThis.fetch=async url=>{requests.push(url);const key=[...raw.keys()].find(file=>url.endsWith('/'+file));assert.ok(key,'Only public OCR assets may be cached');return new Response(raw.get(key));};
 try{
  const reader=await import(`../src/ocr-downloads.js?fixture=${++moduleId}`),states=[];
  const stop=reader.subscribeReaderPreparation(value=>states.push(value));
  const [first,shared]=await Promise.all([reader.prepareReaderFiles(),reader.prepareReaderFiles()]);
  assert.equal(first,shared);assert.equal(requests.length,3);
  assert.deepEqual(Buffer.from(first.model),raw.get('neural/english-mobile.onnx'));
  const repeated=await reader.prepareReaderFiles();assert.equal(requests.length,3);
  assert.deepEqual(Buffer.from(repeated.wasm),raw.get('ort/ort-wasm-simd-threaded.wasm'));
  assert.equal(reader.readerPreparation().savedForReuse,storage==='available');
  assert.equal(reader.readerPreparation().status,'ready');assert.equal(reader.readerPreparation().percent,100);
  assert.ok(states.every(x=>x.percent>=0&&x.percent<=100));stop();
 }finally{globalThis.fetch=before.fetch;globalThis.caches=before.caches;}
});
test('a corrupted cached model is replaced and a wrong network copy cannot become ready',async()=>{
 const before={fetch:globalThis.fetch,caches:globalThis.caches},saved=new Map();let corrupt=true,networkRequests=0;
 const cache={match:async key=>saved.get(key)?.clone(),delete:async key=>saved.delete(key),put:async(key,response)=>saved.set(key,response.clone())};
 globalThis.caches={open:async()=>cache};
 globalThis.fetch=async url=>{
  networkRequests++;const key=[...raw.keys()].find(file=>url.endsWith('/'+file)),bytes=Buffer.from(raw.get(key));
  if(corrupt&&key.endsWith('.onnx'))bytes[0]^=1;
  return new Response(bytes);
 };
 try{
  const reader=await import(`../src/ocr-downloads.js?fixture=${++moduleId}`);
  await assert.rejects(reader.prepareReaderFiles(),/Reader file check failed/);
  assert.equal(reader.readerPreparation().status,'error');
  corrupt=false;await reader.prepareReaderFiles();assert.equal(reader.readerPreparation().status,'ready');
  const modelUrl=[...saved.keys()].find(key=>key.endsWith('.onnx'));
  saved.set(modelUrl,new Response(Buffer.alloc(raw.get('neural/english-mobile.onnx').length)));
  const beforeRepair=networkRequests;await reader.prepareReaderFiles();
  assert.equal(networkRequests,beforeRepair+1);assert.equal(reader.readerPreparation().status,'ready');
 }finally{globalThis.fetch=before.fetch;globalThis.caches=before.caches;}
});
test('automatic preparation respects slow connections and data saving',async()=>{
 const{canPrepareReaderAutomatically:can}=await import('../src/ocr-downloads.js');
 assert.equal(can({effectiveType:'4g',downlink:10,saveData:false}),true);
 assert.equal(can({effectiveType:'4g',downlink:10,saveData:true}),false);
 assert.equal(can({effectiveType:'4g',downlink:3}),false);
 assert.equal(can({effectiveType:'3g',downlink:10}),false);
 assert.equal(can(null),false);
});
