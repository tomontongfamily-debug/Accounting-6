import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { fixture } from './pilot-fixture.mjs';
const migration=fs.readFileSync(new URL('../supabase/migrations/20260923044349_liloan_pilot_preparation.sql',import.meta.url),'utf8');

test('Postgres migration, idempotency, stale saves, historical protection, live guard and restore',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table public.fueltech_reports(report_key text primary key,branch text,report_date date,shift_id text,data jsonb,updated_at timestamptz);
      create table public.fueltech_price_book(branch text,effective_date date,coverage text,shift_id text,prices jsonb,updated_at timestamptz,primary key(branch,effective_date,coverage,shift_id));`);
    await db.exec(migration);
    await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260923053901_optimize_pilot_commit_snapshots.sql',import.meta.url),'utf8'));
    await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260924014306_fix_pilot_conflict_retry_loop.sql',import.meta.url),'utf8'));
    assert.equal((await db.query('select mode from fueltech_pilot_config')).rows[0].mode,'disabled');
    assert.equal((await db.query("select has_function_privilege('anon','public.fueltech_pilot_commit(text,bigint,uuid,text,jsonb,jsonb)','execute') as allowed")).rows[0].allowed,false);
    const {state,key}=fixture();
    const commit=(revision,mutation,data=state,mode='shadow',hash='same')=>db.query('select public.fueltech_pilot_commit($1,$2,$3,$4,$5::jsonb,$6::jsonb) as result',[mode,revision,mutation,hash,JSON.stringify(data),JSON.stringify({ok:true,id:mutation})]);
    await assert.rejects(commit(0,randomUUID()),/configuration changed/);
    await db.exec("update fueltech_pilot_config set mode='shadow',start_date='2026-09-23'");
    const id=randomUUID();await commit(0,id);await commit(0,id);
    assert.equal((await db.query('select revision from fueltech_pilot_state')).rows[0].revision,1);
    assert.equal((await db.query('select count(*)::int as n from fueltech_reports')).rows[0].n,0);
    await assert.rejects(commit(0,id,state,'shadow','different'),/reused/);
    await assert.rejects(commit(0,randomUUID()),error=>error.code==='PT409'&&/Concurrent save/.test(error.message));
    assert.equal((await db.query('select revision from fueltech_pilot_state')).rows[0].revision,1);
    assert.equal((await db.query('select count(*)::int as n from fueltech_pilot_receipts')).rows[0].n,1);
    const edit=structuredClone(state);edit.reports[key].cashierName='Changed';await commit(1,randomUUID(),edit);
    const backup=(await db.query('select data from fueltech_pilot_backups where revision=1')).rows[0].data;
    assert.deepEqual(backup,state);
    const restored=new PGlite();
    try{await restored.exec('create table restore_check(data jsonb)');await restored.query('insert into restore_check values($1)',[JSON.stringify(backup)]);assert.deepEqual((await restored.query('select data from restore_check')).rows[0].data,state);}finally{await restored.close();}
    const historical=structuredClone(edit);Object.values(historical.reports)[0].cashierName='Wrong';
    await assert.rejects(commit(2,randomUUID(),historical),/Historical/);
    await db.exec("update fueltech_pilot_config set mode='live'");
    const live={...state,mode:'live'};await commit(0,randomUUID(),live,'live');
    assert.equal((await db.query('select count(*)::int as n from fueltech_reports')).rows[0].n,1);
    await assert.rejects(db.query("update fueltech_reports set data='{}' where report_key=$1",[key]),/Use the Liloan pilot/);
    await db.query("insert into fueltech_reports values('Mabolo-test','Mabolo','2026-09-23','shift-1','{}',now())");
    await db.exec("set role anon");
    await assert.rejects(db.query('select * from fueltech_pilot_state'),/permission denied/);
    await db.exec('reset role');
  }finally{await db.close();}
});
