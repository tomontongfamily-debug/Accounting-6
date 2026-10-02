import test from 'node:test';
import assert from 'node:assert/strict';
import {backupImmutable} from '../pilot/backup.mjs';
test('Off-project photo backup verifies bytes and makes retries safe',async()=>{
 let saved;const bucket={upload:async(_path,bytes)=>{if(saved)return{error:{message:'exists'}};saved=Buffer.from(bytes);return{};},download:async()=>({data:new Blob([saved])})};
 const db={storage:{from:()=>bucket}},bytes=Buffer.from([255,216,1,2]);
 const first=await backupImmutable('photos/live/test.jpg',bytes,'image/jpeg',db);
 assert.equal(first.reused,false);assert.equal((await backupImmutable('photos/live/test.jpg',bytes,'image/jpeg',db)).sha256,first.sha256);
 await assert.rejects(backupImmutable('photos/live/test.jpg',Buffer.from([255,216,9]),'image/jpeg',db),/could not be verified/);
});
