import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { fixture } from './pilot-fixture.mjs';
import { documents, statePatch } from '../pilot/storage.mjs';
import { execute } from '../pilot/repository.mjs';
import { ensureCurrentReports } from '../pilot/state.mjs';

const sql=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
async function prepared(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table fueltech_reports(report_key text primary key,branch text,report_date date,shift_id text,data jsonb,updated_at timestamptz);
 create table fueltech_price_book(branch text,effective_date date,coverage text,shift_id text,prices jsonb,updated_at timestamptz,primary key(branch,effective_date,coverage,shift_id));`);
 for(const name of ['20260923044349_liloan_pilot_preparation.sql','20260923053901_optimize_pilot_commit_snapshots.sql','20260924014306_fix_pilot_conflict_retry_loop.sql','20261007075000_allow_historical_pos_adjustments.sql'])await db.exec(sql(name));
 return db;
}
test('incremental storage preserves migration, every revision, audit order, POS order, legacy clients and access controls',async()=>{
 const db=await prepared();
 try{
  const {state,key}=fixture();
  state.audit=Array.from({length:150},(_,i)=>({id:randomUUID(),at:'2026-10-01',action:'history',order:i}));
  state.posRedemptionSync={status:'verified',rows:[{id:'b',amount:2},{id:'a',amount:1}],points:[]};
  await db.exec("update fueltech_pilot_config set mode='shadow',start_date='2026-09-23'");
  await db.query('insert into fueltech_pilot_state values($1,7,$2,now())',['shadow',JSON.stringify(state)]);
  await db.exec(sql('20261016072516_pilot_incremental_storage.sql'));
  assert.deepEqual((await db.query('select data from fueltech_pilot_state')).rows[0].data,state);
  assert.deepEqual((await db.query('select data from fueltech_pilot_state_legacy')).rows[0].data,state);
  const load=(limit=0,before=null)=>db.query('select fueltech_pilot_load_v2($1,$2,$3) as v',['shadow',limit,before]).then(r=>r.rows[0].v);
  assert.equal((await load()).data.audit.length,0);
  const page=await load(100);assert.equal(page.data.audit.length,100);assert.equal(page.auditCursor,51);
  assert.equal((await load(100,page.auditCursor)).data.audit.length,50);
  const next=structuredClone(state);next.reports[key].notes='saved once';next.audit.push({id:randomUUID(),action:'notes'});
  const beforeSmall={...state,audit:[]},afterSmall={...next,audit:[next.audit.at(-1)]};
  const patch=statePatch(beforeSmall,afterSmall),id=randomUUID();
  assert.equal(patch.upserts.length,1);assert.equal(patch.audit.length,1);
  assert.ok(JSON.stringify(patch).length<JSON.stringify(state).length/2);
  const commit=(rev,mutation,change,hash='hash')=>db.query('select fueltech_pilot_commit_v2($1,$2,$3,$4,$5,$6) as result',['shadow',rev,mutation,hash,JSON.stringify(change),JSON.stringify({ok:true})]);
  await commit(7,id,patch);await commit(7,id,patch);
  assert.deepEqual((await db.query('select data from fueltech_pilot_state')).rows[0].data,next);
  assert.equal((await db.query('select count(*)::int n from fueltech_pilot_journal')).rows[0].n,1);
  assert.equal((await db.query("select count(*)::int n from fueltech_pilot_documents where changed_revision=8")).rows[0].n,1);
  assert.deepEqual((await db.query("select fueltech_pilot_restore_revision('shadow',7) data")).rows[0].data,state);
  assert.deepEqual((await db.query("select fueltech_pilot_restore_revision('shadow',8) data")).rows[0].data,next);
  await assert.rejects(commit(7,randomUUID(),patch),e=>e.code==='PT409');
  await assert.rejects(commit(8,id,patch,'other'),/reused/);
  const historical=Object.keys(state.reports).find(k=>k!==key);
  await assert.rejects(commit(8,randomUUID(),{upserts:[{section:'reports',key:historical,data:{...state.reports[historical],notes:'forbidden'}}],removals:[],audit:[]}),/Historical/);
  await assert.rejects(commit(8,randomUUID(),{upserts:[],removals:[{section:'reports',key}],audit:[]}),/cannot be removed/);
  const final=structuredClone(next);final.posRedemptionSync.rows.unshift({id:'c',amount:3});final.audit.push({id:randomUUID(),action:'pos'});
  await db.query('select fueltech_pilot_commit($1,8,$2,$3,$4,$5)',['shadow',randomUUID(),'legacy',JSON.stringify(final),JSON.stringify({ok:true})]);
  assert.deepEqual((await db.query('select data from fueltech_pilot_state')).rows[0].data,final);
  assert.deepEqual((await db.query("select fueltech_pilot_restore_revision('shadow',9) data")).rows[0].data,final);
  await db.query("select fueltech_pilot_checkpoint('shadow')");
  assert.deepEqual((await db.query("select fueltech_pilot_restore_revision('shadow',9) data")).rows[0].data,final);
  const delta=(await db.query("select fueltech_pilot_changes_v2('shadow',7,8) v")).rows[0].v;
  assert.equal(delta.full,false);assert.deepEqual(delta.keys,[key]);
  assert.equal((await db.query("select fueltech_pilot_changes_v2('shadow',8,9) v")).rows[0].v.full,true);
  await db.exec('set role service_role');assert.equal((await load()).data.audit.length,0);await db.exec('reset role');
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from fueltech_pilot_documents'),/permission denied/);
  await assert.rejects(load(),/permission denied/);
  await db.exec('reset role');
 }finally{await db.close();}
});
test('storage patches reject audit rewriting and duplicate POS identifiers',()=>{
 const {state}=fixture();state.audit=[{id:'original'}];
 assert.throws(()=>statePatch(state,{...state,audit:[]}),/immutable/);
 assert.throws(()=>documents({...state,posRedemptionSync:{rows:[{id:'same'},{id:'same'}]}}),/unique/);
});

test('repository runs real incremental RPCs, returns deltas and preserves receipts through a concurrent conflict',async()=>{
 const pg=await prepared();
 try{
  const {state,key,cashier}=fixture();
  ensureCurrentReports(state);ensureCurrentReports(state);
  await pg.exec("update fueltech_pilot_config set mode='shadow',start_date='2026-09-23'");
  await pg.query('insert into fueltech_pilot_state values($1,1,$2,now())',['shadow',JSON.stringify(state)]);
  await pg.exec(sql('20261016072516_pilot_incremental_storage.sql'));
  let conflict=true;
  const db={from(table){
   const filters=[];let single=false,cols='*';
   const query={select(value){cols=value;return query;},eq(column,value){filters.push([column,value]);return query;},single(){single=true;return query;},maybeSingle(){single=true;return query;},async then(resolve,reject){
    try{const rows=(await pg.query('select '+cols+' from '+table+(filters.length?' where '+filters.map(([c],i)=>c+'=$'+(i+1)).join(' and '):''),filters.map(([,v])=>v))).rows;for(const row of rows)if(row.start_date instanceof Date)row.start_date=row.start_date.toISOString().slice(0,10);resolve({data:single?rows[0]||null:rows,error:null});}catch(e){reject(e);}
   }};return query;
  },async rpc(name,params){
   if(name==='fueltech_pilot_commit_v2'&&conflict){conflict=false;return {error:{code:'PT409'}};}
   const values=Object.values(params).map(v=>v&&typeof v==='object'?JSON.stringify(v):v);
   try{return {data:(await pg.query('select '+name+'('+values.map((_,i)=>'$'+(i+1)).join(',')+') v',values)).rows[0].v,error:null};}catch(error){return {error};}
  }};
  const envelope=()=>({mode:'shadow',startDate:state.startDate,route:'/api/store/load',input:{paged:true},mutationId:randomUUID()});
  const first=await execute(cashier,envelope(),{db});assert.ok(first.storeRevision>=1);assert.equal(first.delta,false);
  const same=await execute(cashier,{...envelope(),input:{paged:true,sinceRevision:first.storeRevision,storeScope:first.storeScope}},{db});
  assert.equal(same.delta,true);assert.equal(same.reportRows.length,0);assert.equal(same.storeRevision,first.storeRevision);
  const current=(await pg.query('select data from fueltech_pilot_state')).rows[0].data;
  const edit={...current.reports[key],notes:'Repository save'};
  const request={...envelope(),route:'/api/reports/save',input:{report:edit,operation:'save'}};
  const saved=await execute(cashier,request,{db});assert.equal(saved.report.notes,'Repository save');
  assert.deepEqual(await execute(cashier,request,{db}),saved);
  const changed=await execute(cashier,{...envelope(),input:{paged:true,sinceRevision:first.storeRevision,storeScope:first.storeScope}},{db});
  assert.equal(changed.delta,true);assert.ok(changed.reportRows.some(r=>r.report_key===key&&r.data.notes==='Repository save'));
  const unknownScope=await execute(cashier,{...envelope(),input:{paged:true,sinceRevision:changed.storeRevision,storeScope:'Admin'}},{db});assert.equal(unknownScope.delta,false);assert.ok(unknownScope.reportRows.length>0);
 }finally{await pg.close();}
});
