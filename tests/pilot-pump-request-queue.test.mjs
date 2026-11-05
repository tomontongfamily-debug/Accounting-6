import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<30;i++){if(predicate())return;await turn();}assert.ok(predicate(),'Expected request did not start');}
async function clientFixture(t){
 const originalWindow=globalThis.window,originalFetch=globalThis.fetch,calls=[],work=[];let closing=false;
 globalThis.window={__fueltechPilotConfig:{mode:'shadow',start_date:'2026-09-23'}};
 const response=(result,status=200)=>({status,ok:status>=200&&status<300,json:async()=>result});
 globalThis.fetch=async(_url,options)=>{
  if(closing)return response({ok:true});
  const body=JSON.parse(options.body);
  return new Promise(resolve=>calls.push({...body,respond:(result={ok:true},status=200)=>resolve(response(result,status))}));
 };
 const {pilotPost}=await import(`../src/pilot-client.js?queue-test=${randomUUID()}`);
 t.after(async()=>{
  closing=true;for(const call of calls)call.respond();
  await Promise.allSettled(work);
  globalThis.fetch=originalFetch;
  if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;
 });
 const post=(...args)=>{const request=pilotPost(...args);work.push(request);request.catch(()=>{});return request;};
 return {post,calls};
}

test('multiple held pump polls do not queue minutes of reads ahead of a photo or confirmation',async t=>{
 const {post,calls}=await clientFixture(t),reportKey='Liloan__2026-09-23__shift-1';
 const reads=Array.from({length:6},()=>post('/api/demo/pump-report',{reportKey}));
 await until(()=>calls.length===6);
 const photo=post('/api/demo/photo',{reportKey,rowId:'nozzle',revision:0});
 const confirm=post('/api/demo/pump-reading',{reportKey,row:{id:'nozzle'},revision:1});
 await until(()=>calls.length===7);
 assert.equal(calls[6].route,'/api/demo/photo');
 assert.equal(calls.some(call=>call.route==='/api/demo/pump-reading'),false,'Confirmation must still follow the photo write');
 calls[6].respond({ok:true,report:{pilotRevision:1}});await photo;
 await until(()=>calls.length===8);assert.equal(calls[7].route,'/api/demo/pump-reading');
 calls[7].respond({ok:true,report:{pilotRevision:2}});await confirm;
 for(const call of calls.slice(0,6))call.respond({ok:true,report:{pilotRevision:0}});
 await Promise.all(reads);
});

test('a pump poll awaits its existing write snapshot but never blocks later writes or advances their revision',async t=>{
 const {post,calls}=await clientFixture(t),reportKey='Liloan__2026-09-23__shift-1';
 const report={branch:'Liloan',date:'2026-09-23',shiftId:'shift-1',pilotRevision:0};
 const first=post('/api/reports/save',{report});
 const second=post('/api/reports/save',{report});
 const read=post('/api/demo/pump-report',{reportKey});
 const third=post('/api/reports/save',{report});
 await until(()=>calls.length===1);assert.equal(calls[0].route,'/api/reports/save');
 calls[0].respond({ok:true,report:{pilotRevision:1}});await first;
 await until(()=>calls.length===2);assert.equal(calls[1].route,'/api/reports/save');
 assert.equal(calls[1].input.report.pilotRevision,1);
 calls[1].respond({ok:true,report:{pilotRevision:2}});await second;
 await until(()=>calls.length===4);
 const poll=calls.find(call=>call.route==='/api/demo/pump-report'),latest=calls.at(-1);
 assert.equal(latest.route,'/api/reports/save');assert.equal(latest.input.report.pilotRevision,2);
 latest.respond({ok:true,report:{pilotRevision:3}});await third;
 poll.respond({ok:true,report:{pilotRevision:0}});await read;
 const fourth=post('/api/reports/save',{report});await until(()=>calls.length===5);
 assert.equal(calls[4].input.report.pilotRevision,3,'An overtaken read must not lower the last committed write revision');
 assert.equal(new Set(calls.map(call=>call.mutationId)).size,5);
 calls[4].respond({ok:true,report:{pilotRevision:4}});await fourth;
});

test('an overtaken pump poll cannot authorize an old photo confirmation over a replacement',async t=>{
 const {post,calls}=await clientFixture(t);let{state,key,cashier,report}=fixture();
 const oldPhoto='/api/pilot/photo?id=old';
 const old={...report.pumpRows[0],photo_path:oldPhoto,closing:10010,closingEntered:true,readingConfirmed:true,readingRevision:1};
 state.reports[key].pumpRows[0]=old;
 state.photos[oldPhoto]={reportKey:key,rowId:old.id,branch:'Liloan'};
 const oldResult=(await runAction(state,cashier,'/api/demo/pump-report',{reportKey:key})).result;
 const poll=post('/api/demo/pump-report',{reportKey:key});await until(()=>calls.length===1);
 const replacement=post('/api/demo/photo',{reportKey:key,rowId:old.id,data:'data:image/jpeg;base64,/9j/2Q==',replaceReading:true,revision:1});
 await until(()=>calls.length===2);
 const uploaded=await runAction(state,cashier,calls[1].route,calls[1].input,{mutationId:calls[1].mutationId,uploadPhoto:async()=>{}});
 state=uploaded.state;calls[1].respond(uploaded.result);const photo=await replacement;
 const row=photo.report.pumpRows.find(r=>r.id===old.id);
 const confirmation=post('/api/demo/pump-reading',{reportKey:key,revision:row.readingRevision,row:{...row,closing:10020,closingEntered:true,readingConfirmed:true}});
 await until(()=>calls.length===3);
 const confirmed=await runAction(state,cashier,calls[2].route,calls[2].input,{mutationId:calls[2].mutationId});
 state=confirmed.state;calls[2].respond(confirmed.result);await confirmation;
 calls[0].respond(oldResult);await poll;
 const stale=post('/api/demo/pump-reading',{reportKey:key,revision:old.readingRevision,row:old});await until(()=>calls.length===4);
 await assert.rejects(runAction(state,cashier,calls[3].route,calls[3].input),error=>{calls[3].respond({ok:false,error:error.message},error.status);return error.status===409;});
 await assert.rejects(stale,error=>error.status===409);
 assert.equal(state.reports[key].pumpRows[0].closing,10020);
 assert.equal(state.reports[key].pumpRows[0].photo_path,photo.photo_path);
});
