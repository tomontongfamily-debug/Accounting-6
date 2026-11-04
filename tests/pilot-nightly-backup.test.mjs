import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
process.env.SUPABASE_URL='https://accounting.fixture.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only';
process.env.FUELTECH_CV_URL='https://archive.fixture.invalid';
process.env.FUELTECH_CV_SERVICE_ROLE_KEY='fixture-only';
process.env.CRON_SECRET='fixture-cron-only';
const {default:handler}=await import('../api/cron/nightly-backup.js');

for(const failArchive of [false,true])test(`nightly backup verifies independent compressed storage before reporting success (failure=${failArchive})`,async()=>{
 const previous=globalThis.fetch,files=new Map(),events=[],state={audit:[{id:'retained',detail:'history '.repeat(1500000)}]};
 assert.ok(Buffer.byteLength(JSON.stringify(state))>10*1024*1024);
 globalThis.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url||input),method=init.method||'GET';
  if(url.pathname.startsWith('/storage/v1/object/')){
   const key=url.pathname.replace('/storage/v1/object/authenticated/','/storage/v1/object/');
   if(method==='POST'){
    const bytes=Buffer.from(await new Response(init.body).arrayBuffer());
    assert.equal(new Headers(init.headers).get('content-type'),'application/json');
    assert.ok(bytes.length<=10*1024*1024,'Every upload must fit the real backup bucket limit');
    if(failArchive)return new Response(JSON.stringify({message:'fixture storage failure'}),{status:500,headers:{'Content-Type':'application/json'}});
    files.set(key,bytes);events.push('uploaded');
    return new Response(JSON.stringify({Key:key}),{status:200,headers:{'Content-Type':'application/json'}});
   }
   if(!files.has(key))return new Response(JSON.stringify({message:'not found'}),{status:404,headers:{'Content-Type':'application/json'}});
   events.push('verified');return new Response(files.get(key),{status:200});
  }
  let data=[];
  if(url.pathname.endsWith('/fueltech_pilot_config'))data={storage_version:2};
  if(url.pathname.endsWith('/fueltech_pilot_heads'))data=[{mode:'live',revision:1}];
  if(url.pathname.endsWith('/fueltech_pilot_state_legacy'))data={mode:'live',revision:0,data:{audit:[]}};
  if(url.pathname.endsWith('/fueltech_pilot_checkpoint'))data=1;
  if(url.pathname.endsWith('/fueltech_pilot_state'))data=[{mode:'live',revision:1,data:state}];
  if(url.pathname.endsWith('/fueltech_reports'))data=[{report_key:'retained',data:{notes:'preserved'}}];
  if(url.pathname.endsWith('/fueltech_backups')&&method==='POST')events.push('local-success');
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try {
  const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler({method:'POST',headers:{authorization:'Bearer fixture-cron-only'},query:{date:'2026-11-03'}},res);
  if(failArchive){assert.equal(res.code,500);assert.equal(events.includes('local-success'),false);}
  else {
   assert.equal(res.code,200,JSON.stringify(res.body));assert.equal(res.body.ok,true);
   assert.ok(events.lastIndexOf('verified')<events.indexOf('local-success'));
   const file=[...files.entries()].find(([key])=>key.includes('/snapshots/'))[1];
   assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(JSON.parse(file).data,'base64'))).pilot_state_snapshot[0].data,state);
   assert.equal(res.body.offProjectBackup.encoding,'gzip-base64');
  }
 }finally{globalThis.fetch=previous;}
});
