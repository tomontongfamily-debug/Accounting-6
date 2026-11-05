import test from 'node:test';
import assert from 'node:assert/strict';

test('an explicit retry sends the original photo request ID and exact body after an uncertain save',async()=>{
 const originalFetch=globalThis.fetch,originalWindow=globalThis.window;
 globalThis.window={__fueltechPilotConfig:{mode:'live',start_date:'2026-10-03'}};
 const {pilotPost}=await import('../src/pilot-client.js?explicit-photo-retry'),bodies=[];
 const mutationId=crypto.randomUUID(),input={reportKey:'Barili__2026-11-05__shift-1',rowId:'nozzle',revision:3,data:'original-capture'};
 globalThis.fetch=async(_url,options)=>{bodies.push(options.body);return{ok:bodies.length>2,status:bodies.length>2?200:503,json:async()=>bodies.length>2?{ok:true}:{ok:false,error:'The save could not be verified. Retry with the same request.'}};};
 try{
  await assert.rejects(pilotPost('/api/demo/photo',input,'',{mutationId}),e=>e.status===503);
  assert.equal((await pilotPost('/api/demo/photo',input,'',{mutationId})).ok,true);
  assert.equal(bodies.length,3);assert.equal(new Set(bodies).size,1);assert.equal(JSON.parse(bodies[0]).mutationId,mutationId);
 }finally{globalThis.fetch=originalFetch;globalThis.window=originalWindow;}
});

test('a failed station reconstruction is reported once and later actions can recover',async()=>{
 const originalFetch=globalThis.fetch,originalWindow=globalThis.window;
 globalThis.window={__fueltechPilotConfig:{mode:'live',start_date:'2026-10-03'}};
 const {pilotPost}=await import('../src/pilot-client.js?station-records-failure');let calls=0;
 globalThis.fetch=async()=>{calls++;return {ok:calls>1,status:calls>1?200:503,json:async()=>calls>1?{ok:true}:{ok:false,code:'STATION_RECORDS_UNAVAILABLE',error:'Unable to load verified station records.'}};};
 try{
  await assert.rejects(pilotPost('/api/demo/photo',{reportKey:'Moalboal__2026-11-05__shift-2'}),error=>error.code==='STATION_RECORDS_UNAVAILABLE');
  assert.equal(calls,1,'Do not immediately double an expensive failed reconstruction');
  assert.equal((await pilotPost('/api/demo/photo',{reportKey:'Moalboal__2026-11-05__shift-2'})).ok,true);
  assert.equal(calls,2);
 }finally{globalThis.fetch=originalFetch;globalThis.window=originalWindow;}
});

test('read-only timeouts offer a loading retry without claiming an uncertain save',async t=>{
 const originalFetch=globalThis.fetch,originalWindow=globalThis.window;
 globalThis.window={__fueltechPilotConfig:{mode:'live',start_date:'2026-10-03'}};
 t.mock.timers.enable({apis:['setTimeout']});
 const {pilotPost}=await import('../src/pilot-client.js?read-only-timeouts');
 let calls=0;
 globalThis.fetch=async()=>{calls++;return new Promise(()=>{});};
 try{
  for(const route of ['/api/store/load','/api/prices/load','/api/realtime/config','/api/reports/lease','/api/demo/pump-report','/api/demo/deposits','/api/demo/audit','/api/admin/system-health']){
   const rejected=assert.rejects(pilotPost(route),error=>error.code==='PILOT_REQUEST_TIMEOUT'&&error.saveUncertain===false&&/retry loading/i.test(error.message)&&!/save may have completed/i.test(error.message));
   await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(30000);await rejected;
  }
  assert.equal(calls,8);
 }finally{t.mock.timers.reset();globalThis.fetch=originalFetch;globalThis.window=originalWindow;}
});

test('a stalled request releases the cash queue and requires refreshing the saved result',{timeout:1000},async t=>{
 const originalFetch=globalThis.fetch,originalWindow=globalThis.window;
 globalThis.window={__fueltechPilotConfig:{mode:'shadow',start_date:'2026-10-03'}};
 t.mock.timers.enable({apis:['setTimeout']});
 const {pilotPost}=await import('../src/pilot-client.js?stalled-request');
 const calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push(options);
  if(calls.length===1)return new Promise(()=>{});
  return {ok:true,status:200,json:async()=>({ok:true,report:{pilotRevision:8,cashCountConfirmed:true,actualCashCounted:2500}})};
 };
 try{
  const report={branch:'Liloan',date:'2026-10-03',shiftId:'shift-1',pilotRevision:7};
  const stalled=pilotPost('/api/demo/cash-check',{report});
  const rejected=assert.rejects(stalled,error=>error.code==='PILOT_REQUEST_TIMEOUT'&&error.saveUncertain===true&&/Refresh/.test(error.message));
  const queued=pilotPost('/api/demo/pump-report',{reportKey:'Liloan__2026-10-03__shift-1'});
  await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);
  t.mock.timers.tick(30000);
  await rejected;
  const saved=await queued;
  assert.equal(calls[0].signal.aborted,true);assert.equal(calls.length,2);
  assert.equal(saved.report.actualCashCounted,2500);assert.equal(saved.report.cashCountConfirmed,true);
 }finally{t.mock.timers.reset();globalThis.fetch=originalFetch;globalThis.window=originalWindow;}
});

test('a stalled response body is bounded even after the response headers arrive',{timeout:1000},async t=>{
 const originalFetch=globalThis.fetch,originalWindow=globalThis.window;
 globalThis.window={__fueltechPilotConfig:{mode:'shadow',start_date:'2026-10-03'}};
 t.mock.timers.enable({apis:['setTimeout']});
 const {pilotPost}=await import('../src/pilot-client.js?stalled-response-body');
 let signal;
 globalThis.fetch=async(url,options)=>{signal=options.signal;return {ok:true,status:200,json:()=>new Promise(()=>{})};};
 try{
  const report={branch:'Liloan',date:'2026-10-03',shiftId:'shift-1'};
  const rejected=assert.rejects(pilotPost('/api/demo/cash-recount',{report,denominations:{500:5}}),error=>error.code==='PILOT_REQUEST_TIMEOUT'&&error.saveUncertain===true);
  await new Promise(r=>setImmediate(r));t.mock.timers.tick(30000);await rejected;
  assert.equal(signal.aborted,true);
 }finally{t.mock.timers.reset();globalThis.fetch=originalFetch;globalThis.window=originalWindow;}
});

test('Cash and pending draft saves serialize with the latest successful revision',async()=>{
 const originalFetch=globalThis.fetch,originalWindow=globalThis.window;
 globalThis.window={__fueltechPilotConfig:{mode:'shadow',start_date:'2026-10-03'}};
 const {pilotPost}=await import('../src/pilot-client.js?queue-test');
 const calls=[];let release;
 globalThis.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);calls.push(body);
  if(calls.length===1)await new Promise(r=>release=r);
  return {ok:true,status:200,json:async()=>({ok:true,report:{...body.input.report,pilotRevision:calls.length}})};
 };
 try{
  const report={branch:'Liloan',date:'2026-10-03',shiftId:'shift-1',pilotRevision:0,notes:'keep me'};
  const first=pilotPost('/api/reports/save',{report});
  const second=pilotPost('/api/demo/cash-confirm',{report,denominations:{500:12}});
  await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);
  release();await Promise.all([first,second]);assert.equal(calls[1].input.report.pilotRevision,1);
  assert.deepEqual(calls[1].input.denominations,{500:12});assert.equal(calls[1].input.report.notes,'keep me');
 }finally{globalThis.fetch=originalFetch;globalThis.window=originalWindow;}
});

test('Interrupted requests reuse their ID and a failed save does not stall later actions',async()=>{
 const originalFetch=globalThis.fetch,originalWindow=globalThis.window;
 globalThis.window={__fueltechPilotConfig:{mode:'shadow',start_date:'2026-10-03'}};
 const {pilotPost}=await import('../src/pilot-client.js?retry-test');const calls=[];
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);calls.push(body);if(calls.length===1)throw Error('Network interrupted');return {ok:calls.length>2,status:calls.length>2?200:409,json:async()=>calls.length>2?{ok:true}:{ok:false,error:'Other desktop changed'}};};
 try{
  const report={branch:'Liloan',date:'2026-10-03',shiftId:'shift-1',pilotRevision:0};
  await assert.rejects(pilotPost('/api/reports/save',{report}),/Other desktop/);
  assert.equal(calls[0].mutationId,calls[1].mutationId);
  await pilotPost('/api/demo/cash-confirm',{report,denominations:{200:1}});assert.equal(calls.length,3);
 }finally{globalThis.fetch=originalFetch;globalThis.window=originalWindow;}
});

for(const route of ['/api/demo/cash-confirm','/api/demo/delivery-save'])test(`${route} cannot rebase a queued stale full draft over newer saved fields`,async()=>{
 const originalFetch=globalThis.fetch,originalWindow=globalThis.window;
 globalThis.window={__fueltechPilotConfig:{mode:'shadow',start_date:'2026-10-03'}};
 const {pilotPost}=await import(`../src/pilot-client.js?scoped-save-test=${route}`);const calls=[];
 globalThis.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);calls.push(body);
  return {ok:true,status:200,json:async()=>({ok:true,report:{...body.input.report,pilotRevision:54,cashCountConfirmed:true,notes:'Newer saved note'}})};
 };
 try{
  const report={branch:'Liloan',date:'2026-10-03',shiftId:'shift-1',pilotRevision:20,notes:'stale'};
  const cash=pilotPost(route,route.endsWith('delivery-save')?{reportKey:'Liloan__2026-10-03__shift-1',delivery:{id:crypto.randomUUID(),driverName:'Test Driver',product:'Diesel',liters:1000,time:'10:00'}}:{report,denominations:{100:2}});
  const draft=pilotPost('/api/reports/save',{report});await Promise.all([cash,draft]);
  assert.equal(calls[1].input.report.pilotRevision,20);
 }finally{globalThis.fetch=originalFetch;globalThis.window=originalWindow;}
});
