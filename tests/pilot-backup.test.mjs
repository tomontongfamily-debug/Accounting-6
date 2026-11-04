import test from 'node:test';
import assert from 'node:assert/strict';
import {backupImmutable,backupJson} from '../pilot/backup.mjs';
import {gunzipSync} from 'node:zlib';
import {createHash,randomBytes} from 'node:crypto';
test('Off-project photo backup verifies bytes and makes retries safe',async()=>{
 let saved;const bucket={upload:async(_path,bytes)=>{if(saved)return{error:{message:'exists'}};saved=Buffer.from(bytes);return{};},download:async()=>({data:new Blob([saved])})};
 const db={storage:{from:()=>bucket}},bytes=Buffer.from([255,216,1,2]);
 const first=await backupImmutable('photos/live/test.jpg',bytes,'image/jpeg',db);
 assert.equal(first.reused,false);assert.equal((await backupImmutable('photos/live/test.jpg',bytes,'image/jpeg',db)).sha256,first.sha256);
 await assert.rejects(backupImmutable('photos/live/test.jpg',Buffer.from([255,216,9]),'image/jpeg',db),/could not be verified/);
});

test('large JSON backups fit the real bucket limit and restore byte for byte',async()=>{
 const files=new Map();
 const archive=async(path,bytes,type)=>{assert.equal(type,'application/json');assert.ok(bytes.length<=10*1024*1024);files.set(path,Buffer.from(bytes));return{path,sha256:createHash('sha256').update(bytes).digest('hex')};};
 const payload={audit:Array.from({length:300000},(_,i)=>({sequence:i,action:'retained-accounting-history'}))};
 assert.ok(Buffer.byteLength(JSON.stringify(payload))>10*1024*1024);
 const result=await backupJson('snapshots/test.json',payload,archive);
 assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(JSON.parse(files.get(result.path)).data,'base64'))),payload);
 assert.equal(result.uncompressedSha256,createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
});

test('incompressible backups split into bounded verified parts and fail closed on any lost part',async()=>{
 const files=new Map(),payload={data:randomBytes(4096).toString('base64')};
 const archive=async(path,bytes)=>{files.set(path,Buffer.from(bytes));return{path,sha256:createHash('sha256').update(bytes).digest('hex')};};
 const result=await backupJson('snapshots/parts.json',payload,archive,{maxPartBytes:512});
 const manifest=JSON.parse(files.get(result.path));
 assert.ok(manifest.parts.length>1);
 const compressed=Buffer.concat(manifest.parts.map(part=>{const bytes=files.get(part.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),part.sha256);const decoded=Buffer.from(JSON.parse(bytes).data,'base64');assert.equal(decoded.length,part.bytes);assert.ok(decoded.length<=512);return decoded;}));
 assert.equal(createHash('sha256').update(compressed).digest('hex'),manifest.compressedSha256);
 assert.deepEqual(JSON.parse(gunzipSync(compressed)),payload);
 await assert.rejects(backupJson('failed.json',payload,async()=>{throw Error('Verification failed');},{maxPartBytes:512}),/Verification failed/);
});
