import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { compute } from '../src/accounting-engine.js';
import { posRedemptionComparison } from '../src/pos-redemptions.js';
import { posConnectionOptions, posEnabled, readPosRedemptions, normalizePosRedemptions, refreshPosEvidence, refreshPosReport, POS_PERMISSION_QUERY, POS_ROWS_QUERY } from '../pilot/pos-redemptions.mjs';
import { execute } from '../pilot/repository.mjs';
import { runAction } from '../pilot/service.mjs';
import { fixture } from './pilot-fixture.mjs';
import { ensureCurrentReports } from '../pilot/state.mjs';
const env={FUELTECH_POS_READ_DATABASE_URL:'postgresql://fueltech_accounting_reader.zuhvemesqznmbbpzudib:test-password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres'};
const row=(at,amount=100,type='Cash',quantity=0)=>({WithdrawalId:randomUUID(),WithdrawalDate:at,Type:type,CokeQuantity:quantity,RedeemedPoints:amount,OrgCode:'YTL'});
const normalize=rows=>normalizePosRedemptions(rows,'2026-09-23','2026-09-24');
const permissions={reader:'fueltech_accounting_reader',read_only:'on',rls:true,memberships:false,privileged:false,can_write:false,executable_definer:false,private_fields:false};
test('Manila shift boundaries including midnight assign each redemption once',()=>{
  const rows=normalize(['2026-09-23T04:00:00+08:00','2026-09-23T12:59:59+08:00','2026-09-23T13:00:00+08:00','2026-09-23T22:00:00+08:00','2026-09-24T03:59:59+08:00','2026-09-24T04:00:00+08:00'].map(at=>row(at)));
  assert.equal(rows.filter(r=>r.date==='2026-09-23'&&r.shiftId==='shift-1').length,2);
  assert.equal(rows.filter(r=>r.date==='2026-09-23'&&r.shiftId==='shift-2').length,1);
  assert.equal(rows.filter(r=>r.date==='2026-09-23'&&r.shiftId==='shift-3').length,2);
  assert.equal(rows.filter(r=>r.date==='2026-09-24'&&r.shiftId==='shift-1').length,1);
});
test('Duplicate IDs are deduplicated; conflicting, invalid or other-station evidence is rejected',()=>{
  const r=row('2026-09-23T05:00:00+08:00');assert.equal(normalize([r,r]).length,1);
  assert.throws(()=>normalize([r,{...r,RedeemedPoints:101}]),/Conflicting/);
  for(const patch of [{OrgCode:'BRL'},{Type:'Unknown'},{WithdrawalDate:'2026-09-23T05:00:00'},{RedeemedPoints:null},{RedeemedPoints:-1},{RedeemedPoints:'NaN'},{RedeemedPoints:0.001},{CokeQuantity:-1},{Type:'Coke',CokeQuantity:0},{WithdrawalDate:'2026-09-22T22:00:00+08:00'}])assert.throws(()=>normalize([{...r,...patch}]));
});
test('Monetary total includes both cash/fuel while Coke remains a separate CV reference',()=>{
  const {report}=fixture();report.deductions.cashRedemption=100;report.deductions.fuelRedemption=415;
  const rows=normalize([row('2026-09-23T05:00:00+08:00',515),row('2026-09-23T05:01:00+08:00',140,'Coke',2)]);
  const r=refreshPosReport(report,{startDate:report.date,status:'verified',rows,verifiedAt:new Date().toISOString()});
  assert.equal(r.posRedemptions.cashTotal,515);assert.equal(r.posRedemptions.cokeTotal,140);assert.equal(r.posRedemptions.cokeQuantity,2);
  assert.equal(posRedemptionComparison(r).difference,0);assert.deepEqual(r.deductions,report.deductions);
});
test('Submitted cash, deductions, photos, prices and balances survive refreshes and removed POS records',async()=>{
  const {state,key}=fixture();state.reports[key].confirmed=true;state.reports[key].actualCashCounted=500;
  const before=compute(state.reports[key]);const original=structuredClone(state.reports[key]);
  const rows=normalize([row('2026-09-23T05:00:00+08:00',1748)]);
  for(let i=0;i<2;i++)await refreshPosEvidence(state,{enabled:true,force:true,read:async()=>rows});
  const r=state.reports[key];assert.equal(r.posRedemptions.cashTotal,1748);assert.ok(r.checkDetails.some(i=>i.source==='FuelTech POS'));
  for(const field of ['actualCashCounted','deductions','prices','pumpRows','cashDenominations'])assert.deepEqual(r[field],original[field]);
  assert.deepEqual(compute(r),before);assert.equal(state.audit.filter(a=>a.action==='pos-redemptions-read').length,1);
  await refreshPosEvidence(state,{enabled:true,force:true,read:async()=>[]});assert.equal(state.reports[key].posRedemptions.cashTotal,0);assert.equal(state.reports[key].checkDetails.filter(i=>i.source==='FuelTech POS').length,0);assert.deepEqual(compute(state.reports[key]),before);
});
test('Unavailable reads retain last copy and cannot masquerade as zero; recovery replaces it',async()=>{
  const {state,key}=fixture();const rows=normalize([row('2026-09-23T05:00:00+08:00',1461)]);
  await refreshPosEvidence(state,{enabled:true,force:true,read:async()=>rows});
  const last=state.reports[key].posRedemptions.verifiedAt;
  await refreshPosEvidence(state,{enabled:true,force:true,read:async()=>{throw Error('password must never be exposed');}});
  assert.equal(state.reports[key].posRedemptions.status,'unavailable');assert.equal(state.reports[key].posRedemptions.cashTotal,1461);assert.equal(state.reports[key].posRedemptions.verifiedAt,last);assert.ok(!JSON.stringify(state).includes('password must'));
  await refreshPosEvidence(state,{enabled:true,force:true,read:async()=>[]});assert.equal(state.reports[key].posRedemptions.status,'verified');assert.equal(state.reports[key].posRedemptions.cashTotal,0);
});
test('Disabled and shadow/preview modes never initiate a POS read',async()=>{
  const {state}=fixture();let reads=0;await refreshPosEvidence(state,{enabled:false,force:true,read:async()=>{reads++;return [];}});assert.equal(reads,0);
  const enabled={FUELTECH_POS_REDEMPTIONS_ENABLED:'true'};
  assert.equal(posEnabled('live',enabled),true);assert.equal(posEnabled('shadow',enabled),false);assert.equal(posEnabled('live',{...enabled,VERCEL_ENV:'preview'}),false);assert.equal(posEnabled('live',{}),false);
});
test('Privileged URLs, wrong projects, query SSL overrides and arbitrary hosts fail before connection',()=>{
  const options=posConnectionOptions(env);assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(options.application_name,'FuelTech Accounting Liloan reader');
  for(const url of [env.FUELTECH_POS_READ_DATABASE_URL.replace('fueltech_accounting_reader','postgres'),env.FUELTECH_POS_READ_DATABASE_URL.replace('zuhvemesqznmbbpzudib','wrongproject'),env.FUELTECH_POS_READ_DATABASE_URL+'?sslmode=no-verify',env.FUELTECH_POS_READ_DATABASE_URL.replace('aws-0-ap-northeast-1.pooler.supabase.com','example.com')])assert.throws(()=>posConnectionOptions({FUELTECH_POS_READ_DATABASE_URL:url}));
});
test('All pages share one read-only snapshot and fixed parameterized queries',async()=>{
  const calls=[];const first=Array.from({length:1000},()=>row('2026-09-23T05:00:00+08:00'));let pages=0,ended=false;
  const c={async connect(){},async end(){ended=true;},async query(sql,params){calls.push({sql,params});if(sql===POS_PERMISSION_QUERY)return {rows:[permissions]};if(sql===POS_ROWS_QUERY)return {rows:pages++?[]:first};return {rows:[]};}};
  const rows=await readPosRedemptions('2026-09-23','2026-09-24',{env,clientFactory:()=>c});
  assert.equal(rows.length,1000);assert.equal(calls[0].sql,'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(calls.at(-1).sql,'COMMIT');assert.ok(ended);
  const queries=calls.filter(c=>c.sql===POS_ROWS_QUERY);assert.equal(queries.length,2);assert.deepEqual(queries[0].params,['YTL','2026-09-23T04:00:00+08:00','2026-09-25T04:00:00+08:00',null,1000]);assert.equal(queries[1].params[3],first.at(-1).WithdrawalId);
});
test('An accidental privilege expansion stops the read and closes the connection',async()=>{
  for(const bad of [{reader:'postgres'},{read_only:'off'},{rls:false},{can_write:true},{memberships:true},{executable_definer:true},{private_fields:true}]){
    let ended=false,selected=false;
    const c={async connect(){},async end(){ended=true;},async query(sql){if(sql===POS_PERMISSION_QUERY)return {rows:[{...permissions,...bad}]};if(sql===POS_ROWS_QUERY)selected=true;return {rows:[]};}};
    await assert.rejects(readPosRedemptions('2026-09-23','2026-09-24',{env,clientFactory:()=>c}),/read-only/);assert.equal(selected,false);assert.ok(ended);
  }
});
test('Liloan reader policy isolates rows and columns and denies business writes in Postgres',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`CREATE ROLE accounting_reader NOINHERIT NOBYPASSRLS; CREATE TABLE public."Withdrawals"("WithdrawalId" uuid,"OrgCode" text,"RedeemedPoints" numeric,"CustomerId" text);
      INSERT INTO public."Withdrawals" VALUES ('00000000-0000-4000-8000-000000000001','YTL',100,'private'),('00000000-0000-4000-8000-000000000002','BRL',200,'private');
      ALTER TABLE public."Withdrawals" ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA public TO accounting_reader;
      GRANT SELECT ("WithdrawalId","OrgCode","RedeemedPoints") ON public."Withdrawals" TO accounting_reader;
      CREATE POLICY liloan_reader ON public."Withdrawals" FOR SELECT TO accounting_reader USING ("OrgCode"='YTL'); SET ROLE accounting_reader;`);
    const {rows}=await db.query('SELECT "OrgCode","RedeemedPoints" FROM public."Withdrawals"');assert.deepEqual(rows,[{OrgCode:'YTL',RedeemedPoints:'100'}]);
    assert.deepEqual((await db.query(`SELECT "OrgCode" FROM public."Withdrawals" WHERE "OrgCode"='BRL'`)).rows,[]);
    for(const query of ['SELECT "CustomerId" FROM public."Withdrawals"',`EXPLAIN INSERT INTO public."Withdrawals" ("OrgCode") VALUES ('YTL')`,`EXPLAIN UPDATE public."Withdrawals" SET "RedeemedPoints"=0`,`EXPLAIN DELETE FROM public."Withdrawals"`])await assert.rejects(db.query(query),e=>e.code==='42501');
  }finally{await db.close();}
});
test('Live repository refresh commits evidence only to Accounting and throttles subsequent reads',async()=>{
  const {state,key,cashier}=fixture();state.mode='live';ensureCurrentReports(state);ensureCurrentReports(state);let saved=structuredClone(state),reads=0,commits=0;
  const db={from(table){const result={data:table==='fueltech_pilot_config'?{mode:'live',start_date:state.startDate}:table==='fueltech_pilot_state'?{revision:1,data:structuredClone(saved)}:null,error:null};const query=new Proxy({},{get:(_t,k)=>k==='then'?(resolve=>resolve(result)):()=>query});return query;},async rpc(name,p){assert.equal(name,'fueltech_pilot_commit');commits++;saved=p.p_data;return {data:{ok:true}};}};
  const options={db,posEnv:{FUELTECH_POS_REDEMPTIONS_ENABLED:'true'},posRead:async()=>{reads++;return normalize([row('2026-09-23T05:00:00+08:00',1748)]);}};
  for(let i=0;i<2;i++)await execute(cashier,{route:'/api/store/load',mode:'live',startDate:state.startDate,mutationId:randomUUID()},options);
  assert.equal(reads,1);assert.equal(commits,1);assert.equal(saved.reports[key].posRedemptions.cashTotal,1748);assert.deepEqual(saved.reports[key].deductions,state.reports[key].deductions);
});
test('A cashier cannot replace server POS evidence with a forged draft copy',async()=>{
  const {state,key,cashier}=fixture();await refreshPosEvidence(state,{enabled:true,read:async()=>normalize([row('2026-09-23T05:00:00+08:00',1748)])});
  const report=structuredClone(state.reports[key]);report.posRedemptions.cashTotal=0;report.deductions.cashRedemption=100;report.deductions.fuelRedemption=1648;
  const result=await runAction(state,cashier,'/api/reports/save',{report,operation:'save'});
  assert.equal(result.state.reports[key].posRedemptions.cashTotal,1748);assert.equal(posRedemptionComparison(result.state.reports[key]).difference,0);
});
