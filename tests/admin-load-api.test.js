import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {loadStorePages} from '../src/store-pages.js';

// Keep this file's API clients entirely inside the mocked project.
process.env.SUPABASE_URL='https://fixture.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only';
process.env.FUELTECH_SESSION_SECRET='fixture-session-only';
delete process.env.VERCEL_ENV;
const {default:load}=await import('../api/store/load.js');
const {default:health}=await import('../api/admin/system-health.js');
const {createSessionToken}=await import('../api/_shared/session.js');
const response=()=>({code:0,headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},end(body){this.bytes=body;this.body=JSON.parse(gunzipSync(body));}});
const request=role=>({method:'POST',headers:{'x-fueltech-session':createSessionToken({role,branch:'Liloan'})}});
const rows=[...Array.from({length:1215},(_,i)=>({report_key:`A__${String(i).padStart(4,'0')}`,branch:'Liloan',data:{confirmed:true}})),...['2026-10-03','2026-10-04'].flatMap(date=>['shift-1','shift-2','shift-3'].map(shiftId=>({report_key:`Liloan__${date}__${shiftId}`,branch:'Liloan',report_date:date,shift_id:shiftId,data:{pilot:true,confirmed:true,deductions:{gcash:date==='2026-10-04'&&shiftId==='shift-1'?183:0},deposits:[{id:'private-deposit'}]}})))];

for(const role of ['Admin','Manager','Cashier','Approver'])test(`Real load API pages complete reports and preserves ${role} access`,async()=>{
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async input=>{
  const url=new URL(typeof input==='string'?input:input.url||input);calls.push(url);
  let data=[];
  if(url.pathname.endsWith('/fueltech_pilot_config'))data={mode:'disabled'};
  if(url.pathname.endsWith('/fueltech_reports'))data=rows.slice(Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('offset')||0)+Number(url.searchParams.get('limit')||1000));
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{
  const res=response();await load(request(role),res);
  assert.equal(res.code,200,res.body?.error);assert.equal(res.body.reportRows.length,1221);
  const pages=calls.filter(url=>url.pathname.endsWith('/fueltech_reports'));assert.equal(pages.length,2);
  for(const url of pages){assert.equal(url.searchParams.get('order'),'report_key.asc');assert.equal(url.searchParams.get('branch'),['Manager','Cashier'].includes(role)?'eq.Liloan':null);}
  const latest=res.body.reportRows.find(row=>row.report_key==='Liloan__2026-10-04__shift-1').data;
  if(role==='Approver'){assert.equal(latest.deductions,undefined);assert.equal(latest.deposits.length,1);}
  else assert.equal(latest.deductions.gcash,183);
  if(role==='Cashier')assert.deepEqual(latest.deposits,[]);
 }finally{globalThis.fetch=previous;}
});

test('Admin paged API and browser assembler load all 1,221 reports in bounded responses',async()=>{
 const previous=globalThis.fetch,requests=[];
 globalThis.fetch=async input=>{
  const url=new URL(typeof input==='string'?input:input.url||input);
  let data=[];
  if(url.pathname.endsWith('/fueltech_pilot_config'))data={mode:'disabled'};
  if(url.pathname.endsWith('/fueltech_reports')){
   const after=(url.searchParams.get('report_key')||'gt.').slice(3);
   data=rows.filter(row=>row.report_key>after).slice(0,Number(url.searchParams.get('limit')||1000));
  }
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{
  const loaded=await loadStorePages(async body=>{
   const req={...request('Admin'),body},res=response();await load(req,res);assert.equal(res.code,200,res.body?.error);
   requests.push(res.body);assert.ok(Buffer.byteLength(JSON.stringify(res.body))<2*1024*1024);return res.body;
  });
  assert.equal(loaded.reportRows.length,1221);assert.equal(requests.length,7);
  assert.equal(loaded.reportRows.at(-2).data.deductions.gcash,0);
  assert.equal(loaded.reportRows.find(row=>row.report_key==='Liloan__2026-10-04__shift-1').data.deductions.gcash,183);
 }finally{globalThis.fetch=previous;}
});

test('Admin health refreshes a stale cron result after a late cashier submission',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async input=>{
  const url=new URL(typeof input==='string'?input:input.url||input);
  const data=url.pathname.endsWith('/fueltech_system_health')?[{check_date:'2026-10-03',payload:{missing:3}}]:url.pathname.endsWith('/fueltech_reports')?rows.filter(row=>row.report_date==='2026-10-03'):[];
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{
  const res=response();await health(request('Admin'),res);assert.equal(res.code,200,res.body?.error);
  const station=res.body.latestHealth.payload.stations.find(row=>row.branch==='Liloan');
  assert.equal(station.submitted,3);assert.equal(station.missing,0);assert.equal(station.drafts,0);
 }finally{globalThis.fetch=previous;}
});
