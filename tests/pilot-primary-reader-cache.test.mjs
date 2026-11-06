import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {PRIMARY_OCR_DOWNLOADS} from '../src/ocr-downloads.js';

let version=0;
for(const decoded of [false,true])test(`primary worker/core/language persist with verified ${decoded?'HTTP-decoded':'gzip'} language and work without network after refresh`,async()=>{
 const before={fetch:globalThis.fetch,caches:globalThis.caches};
 const saved=new Map(),requests=[];
 globalThis.caches={open:async()=>({match:async key=>saved.get(key)?.clone(),delete:async key=>saved.delete(key),put:async(key,response)=>saved.set(key,response.clone())})};
 globalThis.fetch=async url=>{
  requests.push(url);
  const file=Object.values(PRIMARY_OCR_DOWNLOADS).find(file=>url.endsWith('/'+file.path));assert.ok(file);
  const bytes=fs.readFileSync(new URL('../public/ocr/'+file.path,import.meta.url));
  return new Response(decoded&&file.decoded?gunzipSync(bytes):bytes);
 };
 try{
  const first=await import(`../src/ocr-downloads.js?primaryFixture=${++version}`);
  const files=await first.preparePrimaryReaderFiles();assert.equal(requests.length,3);
  assert.equal(files.worker.byteLength,PRIMARY_OCR_DOWNLOADS.worker.bytes);
  assert.equal(files.language.byteLength,decoded?PRIMARY_OCR_DOWNLOADS.language.decoded.bytes:PRIMARY_OCR_DOWNLOADS.language.bytes);
  assert.ok(files.core.byteLength>=PRIMARY_OCR_DOWNLOADS.plain.bytes);
  globalThis.fetch=async()=>{throw Error('Network disconnected');};
  const refreshed=await import(`../src/ocr-downloads.js?primaryFixture=${++version}`);
  const offline=await refreshed.preparePrimaryReaderFiles();
  for(const key of ['worker','core','language'])assert.deepEqual(Buffer.from(offline[key]),Buffer.from(files[key]));
 }finally{globalThis.fetch=before.fetch;globalThis.caches=before.caches;}
});

test('corrupt primary cache is rejected rather than becoming a trusted reader',async()=>{
 const before={fetch:globalThis.fetch,caches:globalThis.caches};
 globalThis.caches={open:async()=>({match:async()=>new Response(new Uint8Array(10)),delete:async()=>{}})};
 globalThis.fetch=async url=>{
  const file=Object.values(PRIMARY_OCR_DOWNLOADS).find(file=>url.endsWith('/'+file.path));
  const bytes=fs.readFileSync(new URL('../public/ocr/'+file.path,import.meta.url));bytes[0]^=1;
  return new Response(bytes);
 };
 try{const reader=await import(`../src/ocr-downloads.js?primaryFixture=${++version}`);await assert.rejects(reader.preparePrimaryReaderFiles(),/check failed/);}
 finally{globalThis.fetch=before.fetch;globalThis.caches=before.caches;}
});
