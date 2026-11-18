import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {fixture} from './pilot-fixture.mjs';
import {documents,statePatch,loadState,applyCompactDelta} from '../pilot/storage.mjs';
import {readPosRedemptions,refreshPosEvidence,POS_PERMISSION_QUERY,POS_PARTITIONS_QUERY,POS_POINTS_QUERY,POS_ROWS_QUERY,POS_VOIDS_QUERY} from '../pilot/pos-redemptions.mjs';
import {runAction} from '../pilot/service.mjs';
import {execute} from '../pilot/repository.mjs';
import {ensureCurrentReports} from '../pilot/state.mjs';

const migration='20261118080952_reduce_accounting_egress.sql';
const sql=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const env={FUELTECH_POS_READ_DATABASE_URL:'postgresql://fueltech_accounting_reader.zuhvemesqznmbbpzudib:test@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres'};

async function prepared(){
 const pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table fueltech_reports(report_key text primary key,branch text,report_date date,shift_id text,data jsonb,updated_at timestamptz);
 create table fueltech_price_book(branch text,effective_date date,coverage text,shift_id text,prices jsonb,updated_at timestamptz,primary key(branch,effective_date,coverage,shift_id));`);
 for(const name of ['20260923044349_liloan_pilot_preparation.sql','20260923053901_optimize_pilot_commit_snapshots.sql','20260924014306_fix_pilot_conflict_retry_loop.sql','20261007075000_allow_historical_pos_adjustments.sql'])await pg.exec(sql(name));
 const {state}=fixture();
 state.posRedemptionSync={status:'verified',startDate:'2026-09-22',rows:[{id:'a',date:'2026-09-22',shiftId:'shift-3',type:'Cash',amount:20,quantity:0},{id:'b',date:'2026-09-23',shiftId:'shift-1',type:'Cash',amount:30,quantity:0}],points:[{id:'c',date:'2026-09-22',shiftId:'shift-3',points:2,voided:false},{id:'d',date:'2026-09-23',shiftId:'shift-1',points:3,voided:false}]};
 await pg.exec("update fueltech_pilot_config set mode='shadow',start_date='2026-09-23'");
 await pg.query('insert into fueltech_pilot_state values($1,1,$2,now())',['shadow',JSON.stringify(state)]);
 for(const name of ['20261016072516_pilot_incremental_storage.sql','20261016074116_optimize_pilot_document_reads.sql','20261103054839_optimize_liloan_report_reconstruction.sql','20261105053059_avoid_repeated_compact_json_copying.sql',migration])await pg.exec(sql(name));
 return pg;
}
const rpc=(pg,name,args)=>pg.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args.map(v=>v&&typeof v==='object'&&!Array.isArray(v)?JSON.stringify(v):v)).then(r=>r.rows[0].v);
const commit=(pg,revision,patch)=>rpc(pg,'fueltech_pilot_commit_v2',['shadow',revision,randomUUID(),'hash',patch,{}]);

test('compact database deltas reproduce a fresh snapshot, handle removals, and reject expired cursors',async()=>{
 const pg=await prepared();
 try{
  const before=await rpc(pg,'fueltech_pilot_load_compact',['shadow',0,null]);
  const after=structuredClone(before.data);after.sourcesVerifiedAt='2026-11-18T00:00:00Z';
  after.reports[Object.keys(after.reports).at(-1)].notes='another device saved';
  after.photos.new={path:'proof.jpg'};after.posRedemptionSync.status='unavailable';
  await commit(pg,1,statePatch(before.data,after));
  const delta=await rpc(pg,'fueltech_pilot_load_delta',['shadow',1]);
  assert.equal(delta.full,false);assert.ok(delta.upserts.length>0);
  assert.ok(delta.upserts.every(r=>!['pos_rows','pos_points'].includes(r.section)));
  const actual=applyCompactDelta(before,delta);
  assert.deepEqual(actual,await rpc(pg,'fueltech_pilot_load_compact',['shadow',0,null]));
  const next=structuredClone(after);delete next.posRedemptionSync.startDate;
  await commit(pg,2,statePatch(after,next));
  const removed=await rpc(pg,'fueltech_pilot_load_delta',['shadow',2]);
  assert.deepEqual(removed.removals,[{section:'pos',key:'startDate'}]);
  assert.deepEqual(applyCompactDelta(actual,removed),await rpc(pg,'fueltech_pilot_load_compact',['shadow',0,null]));
  await pg.exec('truncate fueltech_pilot_journal');
  assert.equal((await rpc(pg,'fueltech_pilot_load_delta',['shadow',2])).full,true);
  assert.equal((await rpc(pg,'fueltech_pilot_load_delta',['shadow',3])).full,false);
  for(const role of ['anon','authenticated']){
   await pg.exec('set role '+role);
   await assert.rejects(rpc(pg,'fueltech_pilot_load_delta',['shadow',3]),/permission denied/);
   await assert.rejects(rpc(pg,'fueltech_pilot_load_pos_window',['shadow',['2026-09-23']]),/permission denied/);
   await pg.exec('reset role');
  }
 }finally{await pg.close();}
});

test('window-only POS changes preserve outside-day evidence, full ordering, audit history and removals',async()=>{
 const pg=await prepared();
 try{
  const original=(await pg.query("select data from fueltech_pilot_state where mode='shadow'")).rows[0].data;
  const window=await rpc(pg,'fueltech_pilot_load_pos_window',['shadow',['2026-09-23']]);
  assert.deepEqual(window.data.rows.map(r=>r.id),['b']);assert.deepEqual(window.data.points.map(r=>r.id),['d']);
  const before=structuredClone(original);before.posRedemptionSync=window.data;
  const after=structuredClone(before);after.posRedemptionSync.rows=[];
  after.posRedemptionSync.points=[{...window.data.points[0],voided:true,points:null},{id:'e',date:'2026-09-23',shiftId:'shift-2',points:4,voided:false}];
  const patch=statePatch(before,after);
  assert.deepEqual(patch.removals,[{section:'pos_rows',key:'b'}]);
  assert.ok(patch.upserts.every(r=>r.key!=='_window'&&r.key!=='_deferred'&&r.key!=='a'&&r.key!=='c'));
  await commit(pg,1,patch);
  const persisted=(await pg.query("select data from fueltech_pilot_state where mode='shadow'")).rows[0].data;
  assert.deepEqual(persisted.posRedemptionSync.rows,[original.posRedemptionSync.rows[0]]);
  assert.deepEqual(persisted.posRedemptionSync.points,[original.posRedemptionSync.points[0],...after.posRedemptionSync.points]);
  assert.deepEqual(persisted.audit,original.audit);
  assert.equal(persisted.posRedemptionSync._window,undefined);
  assert.deepEqual((await rpc(pg,'fueltech_pilot_restore_revision',['shadow',1])).posRedemptionSync,original.posRedemptionSync);
 }finally{await pg.close();}
});

test('warm readers check revisions, coalesce requests, apply changes and isolate callers without repeated full downloads',async()=>{
 let revision=1,full=0,deltas=0;
 const state={mode:'live',reports:{one:{notes:'first'}},photos:{},audit:[],posRedemptionSync:{status:'verified',_deferred:true}};
 const db={from(){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:{revision}};}};return q;},async rpc(name){
  if(name==='fueltech_pilot_load_compact'){full++;return {data:{revision,data:structuredClone(state),auditCursor:null}};}
  assert.equal(name,'fueltech_pilot_load_delta');deltas++;return {data:{revision,full:false,upserts:[{section:'reports',key:'one',data:{notes:'changed'}}],removals:[]}};
 }};
 const reads=await Promise.all(Array.from({length:12},()=>loadState(db,'live',{cache:true})));
 reads[0].data.reports.one.notes='untrusted edit';assert.equal(reads[1].data.reports.one.notes,'first');assert.equal(full,1);
 const next=await loadState(db,'live',{cache:true});assert.equal(full,1);assert.equal(next.data.reports.one.notes,'first');
 revision=2;
 const changed=await Promise.all(Array.from({length:12},()=>loadState(db,'live',{cache:true})));
 assert.equal(full,1);assert.equal(deltas,1);assert.equal(changed[0].data.reports.one.notes,'changed');
});

test('daily source digests detect historical edits, deletion, random-ID insertion, midnight boundaries and late duplicate voids',async()=>{
 const pg=new PGlite();let calls=[];
 try{
  await pg.exec(`create table "Withdrawals"("WithdrawalId" uuid,"WithdrawalDate" timestamptz,"Type" text,"CokeQuantity" integer,"RedeemedPoints" numeric,"OrgCode" text);
   create table "Transactions"("TransactionId" uuid,"TransactionDate" timestamptz,"OrgCode" text,"Discount" numeric,"Liter" numeric);
   create table "VoidedTransactions"("TransactionDate" timestamptz,"OrgCode" text,"Discount" numeric,"Liter" numeric);
   insert into "Withdrawals" values('ffffffff-ffff-4fff-8fff-ffffffffffff','2026-09-23T05:00:00+08:00','Cash',0,25,'YTL');
   insert into "Transactions" values('ffffffff-ffff-4fff-8fff-ffffffffffff','2026-09-24T03:59:59.123456+08:00','YTL',9,3),('ffffffff-ffff-4fff-8fff-fffffffffffe','2026-09-24T04:00:00+08:00','YTL',12,4),('ffffffff-ffff-4fff-8fff-fffffffffffd','2026-09-24T04:00:00+08:00','BRL',99,33);
   create role fueltech_accounting_reader noinherit nobypassrls;
   grant usage on schema public to fueltech_accounting_reader;
   grant select("WithdrawalId","WithdrawalDate","Type","CokeQuantity","RedeemedPoints","OrgCode") on "Withdrawals" to fueltech_accounting_reader;
   grant select("TransactionId","TransactionDate","OrgCode","Discount","Liter") on "Transactions" to fueltech_accounting_reader;
   grant select("TransactionDate","OrgCode","Discount","Liter") on "VoidedTransactions" to fueltech_accounting_reader;`);
  for(const table of ['Withdrawals','Transactions','VoidedTransactions'])await pg.exec(`alter table "${table}" enable row level security;create policy reader on "${table}" for select to fueltech_accounting_reader using ("OrgCode"='YTL')`);
  const client={async connect(){await pg.exec('set role fueltech_accounting_reader');},async end(){await pg.exec('reset role');},async query(query,args){calls.push({query,args});
   return pg.query(query,args);
  }};
  const read=options=>readPosRedemptions('2026-09-23','2026-09-24',{env,clientFactory:()=>client,...options});
  const first=await read({partitions:null});assert.equal(first.points.length,2);assert.equal(first.points.find(p=>p.id==='ffffffff-ffff-4fff-8fff-ffffffffffff').date,'2026-09-23');
  calls=[];const same=await read({partitions:first.partitions});assert.deepEqual(same.windows,[]);
  assert.equal(calls.filter(c=>[POS_ROWS_QUERY,POS_POINTS_QUERY,POS_VOIDS_QUERY].includes(c.query)).length,0);
  assert.equal(calls.filter(c=>c.query===POS_PARTITIONS_QUERY).length,1);
  await pg.exec(`update "Withdrawals" set "RedeemedPoints"=27;
   insert into "Transactions" values('00000000-0000-4000-8000-000000000001','2026-09-23T09:00:00+08:00','YTL',3,1);
   insert into "VoidedTransactions" values('2026-09-24T03:59:59.123456+08:00','YTL',9,3);`);
  calls=[];const edit=await read({partitions:first.partitions});assert.deepEqual(edit.windows,['2026-09-23']);
  assert.equal(edit.rows[0].amount,27);assert.equal(edit.points.length,2);assert.equal(edit.points.filter(p=>p.voided).length,1);
  assert.ok(calls.filter(c=>[POS_ROWS_QUERY,POS_POINTS_QUERY,POS_VOIDS_QUERY].includes(c.query)).every(c=>c.args[1]==='2026-09-23T04:00:00+08:00'&&c.args[2]==='2026-09-24T04:00:00+08:00'));
  await pg.exec(`insert into "VoidedTransactions" select * from "VoidedTransactions"`);
  const duplicate=await read({partitions:edit.partitions});assert.deepEqual(duplicate.windows,['2026-09-23']);
  await pg.exec(`delete from "Transactions" where "OrgCode"='YTL' and "TransactionDate">='2026-09-24T04:00:00+08:00'`);
  const removed=await read({partitions:duplicate.partitions});assert.deepEqual(removed.windows,['2026-09-24']);assert.deepEqual(removed.points,[]);
 }finally{await pg.close();}
});

test('unchanged compact evidence verifies without history downloads; forced failures preserve totals and block cash-check',async()=>{
 const {state,key,cashier}=fixture();
 const previousDate=Object.values(state.reports).find(r=>r.date<state.startDate).date;
 await refreshPosEvidence(state,{enabled:true,force:true,read:async()=>({rows:[{id:'current',date:state.startDate,shiftId:'shift-1',amount:35,type:'Cash',quantity:0},{id:'old',date:previousDate,shiftId:'shift-3',amount:20,type:'Cash',quantity:0}],points:[],partitions:{[state.startDate]:'a'}})});
 const full=structuredClone(state.posRedemptionSync);const {rows:_r,points:_p,...meta}=full;
 state.posRedemptionSync={...meta,_deferred:true};let reads=0,hydrates=0;
 await refreshPosEvidence(state,{enabled:true,force:true,hydrate:async()=>{hydrates++;throw Error('should not download');},read:async()=>{reads++;return {rows:[],points:[],windows:[],partitions:full.partitions};}});
 assert.equal(reads,1);assert.equal(hydrates,0);assert.equal(state.reports[key].deductions.posRedemption,35);
 const historical=Object.values(state.reports).find(r=>r.date===previousDate);assert.equal(historical.deductions.posRedemption,20);
 await refreshPosEvidence(state,{enabled:true,force:true,read:async()=>{reads++;throw Error('unavailable');}});
 assert.equal(reads,2);assert.equal(state.reports[key].deductions.posRedemption,35);
 assert.equal(state.reports[key].posRedemptions.status,'unavailable');
 await assert.rejects(runAction(state,cashier,'/api/demo/cash-check',{report:state.reports[key]}),/Verify automatic POS/);
 await assert.rejects(runAction(state,cashier,'/api/reports/save',{report:state.reports[key],operation:'submit'}),/Verify automatic POS/);
});

test('a changed date updates its POS totals while historical days retain authoritative summaries and documents',async()=>{
 const {state,key}=fixture();const oldDate=Object.values(state.reports).find(r=>r.date<state.startDate).date;
 const rows=[{id:'a',date:oldDate,shiftId:'shift-3',amount:20,type:'Cash',quantity:0},{id:'b',date:state.startDate,shiftId:'shift-1',amount:35,type:'Cash',quantity:0}];
 await refreshPosEvidence(state,{enabled:true,force:true,read:async()=>({rows,points:[]})});
 const full=structuredClone(state.posRedemptionSync),{rows:_rows,points:_points,...metadata}=full;
 state.posRedemptionSync={...metadata,_deferred:true};let before;
 await refreshPosEvidence(state,{enabled:true,force:true,read:async()=>({rows:[{...rows[1],amount:41}],points:[],windows:[state.startDate],partitions:{[state.startDate]:'changed'}}),hydrate:async dates=>{
  const partial={...metadata,rows:[rows[1]],points:[],_window:{dates,order:{rows:['a','b'],points:[]},loaded:{rows:['b'],points:[]}}};
  before=structuredClone(state);before.posRedemptionSync=structuredClone(partial);return partial;
 }});
 assert.equal(state.reports[key].deductions.posRedemption,41);
 assert.equal(Object.values(state.reports).find(r=>r.date===oldDate).deductions.posRedemption,20);
 const patch=statePatch(before,state);assert.ok(!patch.removals.some(r=>r.key==='a'));
 assert.deepEqual(patch.upserts.find(r=>r.section==='shape'&&r.key==='rows')?.data??['a','b'],['a','b']);
 assert.equal(documents(state).some(r=>r.key==='_window'),false);
});

for(const route of ['/api/demo/cash-check','/api/reports/save'])test(`fresh ${route} verifies sources despite a recent compact snapshot and fails closed`,async()=>{
 const {state,key,cashier}=fixture();state.mode='live';ensureCurrentReports(state);ensureCurrentReports(state);
 await refreshPosEvidence(state,{enabled:true,force:true,read:async()=>({rows:[],points:[],partitions:{}})});
 const {rows:_rows,points:_points,...metadata}=state.posRedemptionSync;state.posRedemptionSync={...metadata,_deferred:true};
 let sourceChecks=0,posChecks=0;
 const query=data=>{const q=new Proxy({}, {get:(_t,name)=>name==='then'?(resolve=>resolve({data,error:null,count:0})):(()=>q)});return q;};
 const db={from(table){if(table==='transactions')sourceChecks++;return query(table==='fueltech_pilot_config'?{mode:'live',start_date:state.startDate,storage_version:2}:table==='fueltech_pilot_receipts'?null:[]);},async rpc(name){assert.equal(name,'fueltech_pilot_load_compact');return {data:{revision:1,data:structuredClone(state)}};}};
 await assert.rejects(execute(cashier,{mode:'live',startDate:state.startDate,route,input:{report:state.reports[key],operation:'submit'},mutationId:randomUUID()},{db,cvClient:{from:()=>query([])},posEnv:{FUELTECH_POS_REDEMPTIONS_ENABLED:'true'},posRead:async()=>{posChecks++;throw Error('POS unavailable');}}),/Verify automatic POS/);
 assert.ok(sourceChecks>0,'Pay records must be freshly queried');assert.equal(posChecks,1);
});
