import test from 'node:test';
import assert from 'node:assert/strict';

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
