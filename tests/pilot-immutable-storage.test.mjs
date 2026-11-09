import test from 'node:test';
import assert from 'node:assert/strict';
import {storeImmutable} from '../pilot/immutable-storage.mjs';

const options={contentType:'image/jpeg',verifyUpload:true,message:'Photo verification failed'};
test('simultaneous identical uploads write once and verify both callers without duplicate inserts',async()=>{
 let stored,uploads=0,downloads=0;
 const bucket={
  async list(_folder,{search}){return{data:stored?[{name:search}]:[]};},
  async upload(_path,bytes){uploads++;await new Promise(r=>setTimeout(r,10));stored=Buffer.from(bytes);return{};},
  async download(){downloads++;return{data:new Blob([stored])};},
 };
 const db={storage:{from:()=>bucket}},bytes=Buffer.from('same photo');
 const results=await Promise.all([storeImmutable(db,'private','live/photo.jpg',bytes,options),storeImmutable(db,'private','live/photo.jpg',bytes,options)]);
 assert.equal(uploads,1);assert.equal(downloads,2);assert.equal(results[0].sha256,results[1].sha256);assert.equal(results[1].reused,true);
 await assert.rejects(storeImmutable(db,'private','live/photo.jpg',Buffer.from('different'),options),e=>e.status===503);
 assert.equal(uploads,1);assert.deepEqual(stored,bytes);
});
test('a cross-server upload race reuses only matching bytes',async()=>{
 for(const identical of [true,false]){
  let uploaded=0;
  const bytes=Buffer.from('intended photo'),bucket={list:async()=>({data:[]}),upload:async()=>{uploaded++;return{error:{code:'KeyAlreadyExists'}};},download:async()=>({data:new Blob([identical?bytes:Buffer.from('other photo')])})};
  const run=()=>storeImmutable({storage:{from:()=>bucket}},'private','photo.jpg',bytes,options);
  if(identical)assert.equal((await run()).reused,true);else await assert.rejects(run(),e=>e.status===503);
  assert.equal(uploaded,1);
 }
});
test('storage outages, missing backups and uncertain uploads never acknowledge an unverified copy',async()=>{
 for(const stage of ['list','upload','download']){
  let uploads=0;
  const bucket={list:async()=>stage==='list'?{error:{message:'unavailable'}}:{data:[]},upload:async()=>{uploads++;return stage==='upload'?{error:{message:'timeout'}}:{};},download:async()=>({error:{message:'missing'}})};
  await assert.rejects(storeImmutable({storage:{from:()=>bucket}},'private','photo.jpg',Buffer.from('photo'),options),e=>e.status===503);
  assert.equal(uploads,stage==='list'?0:1);
 }
});
test('simultaneous different bytes cannot replace a capture in flight',async()=>{
 let release;
 const gate=new Promise(r=>{release=r;}),stored=Buffer.from('original');
 const bucket={list:async()=>({data:[]}),upload:async()=>{await gate;return{};},download:async()=>({data:new Blob([stored])})};
 const db={storage:{from:()=>bucket}};
 const first=storeImmutable(db,'private','photo.jpg',stored,options);
 await assert.rejects(storeImmutable(db,'private','photo.jpg',Buffer.from('other'),options),e=>e.status===503);
 release();await first;
});
