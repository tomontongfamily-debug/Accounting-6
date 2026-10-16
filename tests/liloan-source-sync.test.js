import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createHandler} from '../api/integrations/liloan-cv.js';
import {createHandler as cronHandler} from '../api/cron/liloan-source-sync.js';
const secret='test-only-source-sync-secret';
const body={station:'liloan',voucherId:'00000000-0000-4000-8000-000000000001',status:'approved'};
function req(payload=body,timestamp=String(Math.floor(Date.now()/1000))) {
 const signature=createHmac('sha256',secret).update(`${timestamp}.${payload.station}.${payload.voucherId}.${payload.status}`).digest('hex');
 return {method:'POST',body:payload,headers:{'x-fueltech-timestamp':timestamp,'x-fueltech-signature':`v1=${signature}`}};
}
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(value){this.value=value;return this;}};}
test('CV notification authenticates the Liloan server event and never forwards client amounts or shifts',async()=>{
 let calls=0,args;
 const handler=createHandler({env:{FUELTECH_CV_SYNC_SECRET:secret},sync:async(...input)=>{calls++;args=input;}});
 const res=response();await handler(req({...body,amount:900000,date:'1900-01-01',shiftId:'shift-3'}),res);
 assert.equal(res.code,200);assert.equal(calls,1);assert.deepEqual(args,[]);assert.equal(res.value.station,'liloan');
 for(const bad of [req({...body,station:'mabolo'}),req({...body,status:'pending'}),req(body,'1600000000'),{...req(),headers:{}},{...req(),method:'GET'}]){
  const r=response();await handler(bad,r);assert.ok([401,405].includes(r.code));
 }
 assert.equal(calls,1);
 const malformed=response();await handler({...req(),body:'{'},malformed);assert.equal(malformed.code,400);
});
test('source errors stay retryable and scheduled reconciliation is private',async()=>{
 const failed=response();await createHandler({env:{FUELTECH_CV_SYNC_SECRET:secret},sync:async()=>{throw Error('offline');}})(req(),failed);assert.equal(failed.code,503);
 let calls=0;const cron=cronHandler({env:{CRON_SECRET:secret},sync:async()=>{calls++;}});
 const denied=response();await cron({method:'GET',headers:{}},denied);assert.equal(denied.code,401);assert.equal(calls,0);
 const ok=response();await cron({method:'GET',headers:{authorization:`Bearer ${secret}`}},ok);assert.equal(ok.code,200);assert.equal(calls,1);
});
