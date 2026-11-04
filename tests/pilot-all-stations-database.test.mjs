import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { fixture } from './pilot-fixture.mjs';
import { prepareStationRollout } from '../pilot/station-rollout.mjs';
import { statePatch } from '../pilot/storage.mjs';
import { withStationRollout } from '../src/station-rollout.js';

test('all-station PostgreSQL rollout preserves history, journals setup, guards old endpoints and replays safely',async()=>{
 const pg=new PGlite();
 try{
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table fueltech_reports(report_key text primary key,branch text,report_date date,shift_id text,data jsonb,updated_at timestamptz);
   create table fueltech_price_book(branch text,effective_date date,coverage text,shift_id text,prices jsonb,updated_at timestamptz,primary key(branch,effective_date,coverage,shift_id));
   insert into fueltech_reports values('Arpili__2026-11-03__shift-1','Arpili','2026-11-03','shift-1','{"confirmed":true,"original":"retained"}',now());`);
  const sql=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
  for(const name of ['20260923044349_liloan_pilot_preparation.sql','20260923053901_optimize_pilot_commit_snapshots.sql','20260924014306_fix_pilot_conflict_retry_loop.sql','20261007075000_allow_historical_pos_adjustments.sql'])await pg.exec(sql(name));
  const {state}=fixture();state.mode='live';state.startDate='2026-10-03';
  await pg.exec("update fueltech_pilot_config set mode='live',start_date='2026-10-03'");
  await pg.query('insert into fueltech_pilot_state values($1,1,$2,now())',['live',JSON.stringify(state)]);
  for(const name of ['20261016072516_pilot_incremental_storage.sql','20261016074116_optimize_pilot_document_reads.sql','20261103054839_optimize_liloan_report_reconstruction.sql','20261103055135_batch_liloan_pos_evidence_reads.sql','20261104055302_all_station_rollout.sql'])await pg.exec(sql(name));
  const after=structuredClone(state);prepareStationRollout(after,withStationRollout({mode:'live',start_date:state.startDate}));
  const patch=statePatch(state,after),id=randomUUID();
  const commit=(revision,mutation,change)=>pg.query("select fueltech_pilot_commit_v2('live',$1,$2,'test',$3,'{}')",[revision,mutation,JSON.stringify(change)]);
  await commit(1,id,patch);await commit(1,id,patch);
  const setups=(await pg.query("select branch,data from fueltech_reports where report_date='2026-11-04' and shift_id='shift-3' order by branch")).rows;
  assert.equal(setups.length,5);assert.ok(setups.every(r=>r.data.baselineReport&&!r.data.confirmed));
  assert.equal((await pg.query("select data from fueltech_reports where report_key='Arpili__2026-11-03__shift-1'")).rows[0].data.original,'retained');
  assert.equal((await pg.query("select revision from fueltech_pilot_heads where mode='live'")).rows[0].revision,2);
  assert.deepEqual((await pg.query("select data from fueltech_pilot_state where mode='live'")).rows[0].data,after);
  await assert.rejects(pg.query("insert into fueltech_reports values('Mabolo__2026-11-05__shift-1','Mabolo','2026-11-05','shift-1','{}',now())"),/new station workflow/);
  await assert.rejects(pg.query("update fueltech_reports set data='{}' where report_key='Mabolo__2026-11-04__shift-3'"),/new station workflow/);
  await assert.rejects(commit(2,randomUUID(),{upserts:[{section:'reports',key:'Unknown__2026-11-05__shift-1',data:{branch:'Unknown',date:'2026-11-05',shiftId:'shift-1'}}],removals:[],audit:[]}),/station violation/);
  await assert.rejects(commit(2,randomUUID(),{upserts:[],removals:[{section:'root',key:'stationStarts'}],audit:[]}),/cannot be removed/);
  await pg.exec('set role anon');await assert.rejects(pg.query('select * from fueltech_pilot_documents'),/permission denied/);
 }finally{await pg.close();}
});
