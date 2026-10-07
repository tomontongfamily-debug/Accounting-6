import { Client } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { accountingTiming, dateOffset } from './integrations.mjs';
import { posRedemptionIssues } from '../src/pos-redemptions.js';

export const POS_PROJECT='zuhvemesqznmbbpzudib';
export const POS_READER='fueltech_accounting_reader';
const PAGE_SIZE=1000, MAX_ROWS=20000;
export function posEnabled(mode,env=process.env) {
  return mode==='live'&&env.VERCEL_ENV!=='preview'&&env.FUELTECH_POS_REDEMPTIONS_ENABLED==='true';
}
export function posConnectionOptions(env=process.env) {
  const url=new URL(env.FUELTECH_POS_READ_DATABASE_URL||'');
  const direct=url.hostname===`db.${POS_PROJECT}.supabase.co`;
  const pooled=url.hostname==='aws-0-ap-northeast-1.pooler.supabase.com';
  const expectedUser=direct?POS_READER:`${POS_READER}.${POS_PROJECT}`;
  if(!['postgres:','postgresql:'].includes(url.protocol)||(!direct&&!pooled)||decodeURIComponent(url.username)!==expectedUser||!url.password||url.pathname!=='/postgres'||url.search||url.hash||!['5432','6543'].includes(url.port))throw Error('A dedicated POS read-only connection is required.');
  // Parse fields explicitly so URL sslmode parameters cannot disable certificate verification.
  return {host:url.hostname,port:Number(url.port),database:'postgres',user:expectedUser,password:decodeURIComponent(url.password),ssl:{rejectUnauthorized:true,...(env.FUELTECH_POS_CA_CERT?{ca:env.FUELTECH_POS_CA_CERT}:{})},connectionTimeoutMillis:5000,query_timeout:10000,application_name:'FuelTech Accounting Liloan reader'};
}
export const POS_PERMISSION_QUERY=`SELECT current_user AS reader,
 current_setting('transaction_read_only') AS read_only,
 (SELECT relrowsecurity FROM pg_class WHERE oid='public."Withdrawals"'::regclass) AS rls,
 EXISTS (SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS memberships,
 EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) AS privileged,
 EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND c.relkind IN ('r','p','v','m','f') AND (has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE,REFERENCES'))) AS can_write,
 EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') AND has_function_privilege(current_user,p.oid,'EXECUTE')) AS executable_definer,
 has_column_privilege(current_user,'public."Withdrawals"','CustomerId','SELECT') OR has_column_privilege(current_user,'public."Withdrawals"','UserId','SELECT') AS private_fields`;
export const POS_ROWS_QUERY=`SELECT "WithdrawalId","WithdrawalDate","Type","CokeQuantity","RedeemedPoints","OrgCode"
 FROM public."Withdrawals" WHERE "OrgCode"=$1 AND "WithdrawalDate">=$2::timestamptz AND "WithdrawalDate"<$3::timestamptz
 AND ($4::uuid IS NULL OR "WithdrawalId">$4::uuid) ORDER BY "WithdrawalId" LIMIT $5`;
export async function readPosRedemptions(startDate,endDate,{env=process.env,clientFactory=options=>new Client(options)}={}) {
  const start=`${dateOffset(startDate,0)}T04:00:00+08:00`, end=`${dateOffset(endDate,1)}T04:00:00+08:00`;
  if(startDate>endDate)throw Error('Invalid POS reporting window.');
  const client=clientFactory(posConnectionOptions(env));
  try {
    await client.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const {rows:[permission]}=await client.query(POS_PERMISSION_QUERY);
    if(!permission||permission.reader!==POS_READER||permission.read_only!=='on'||permission.rls!==true||['memberships','privileged','can_write','executable_definer','private_fields'].some(k=>permission[k]!==false))throw Error('POS connection does not satisfy the read-only access rules.');
    const rows=[];let cursor=null;
    for(;;) {
      const result=await client.query(POS_ROWS_QUERY,['YTL',start,end,cursor,PAGE_SIZE]);
      rows.push(...result.rows);
      if(rows.length>MAX_ROWS)throw Error('POS reporting window exceeds the verified import limit.');
      if(result.rows.length<PAGE_SIZE)break;
      const next=result.rows.at(-1).WithdrawalId;
      if(next===cursor)throw Error('POS pagination did not advance.');
      cursor=next;
    }
    await client.query('COMMIT');
    return normalizePosRedemptions(rows,startDate,endDate);
  } catch(error) {
    try{await client.query('ROLLBACK');}catch{/* Connection may not have opened. */}
    throw error;
  } finally {await client.end();}
}
export function normalizePosRedemptions(rows,startDate,endDate) {
  const byId=new Map();
  for(const row of rows) {
    const at=row.WithdrawalDate instanceof Date?row.WithdrawalDate.toISOString():row.WithdrawalDate;
    const {date,shiftId}=accountingTiming(at);
    const amount=Number(row.RedeemedPoints), quantity=Number(row.CokeQuantity);
    if(row.OrgCode!=='YTL'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.WithdrawalId||'')||date<startDate||date>endDate||!['Cash','Coke'].includes(row.Type)||row.RedeemedPoints==null||row.RedeemedPoints===''||!Number.isFinite(amount)||amount<0||amount>1e9||Math.abs(amount*100-Math.round(amount*100))>0.00001||row.CokeQuantity==null||!Number.isInteger(quantity)||quantity<0||(row.Type==='Cash'&&quantity!==0)||(row.Type==='Coke'&&quantity===0))throw Error('Invalid POS redemption evidence.');
    const value={id:row.WithdrawalId,at:new Date(at).toISOString(),date,shiftId,type:row.Type,amount,quantity};
    if(byId.has(value.id)&&JSON.stringify(byId.get(value.id))!==JSON.stringify(value))throw Error('Conflicting POS redemption ID.');
    byId.set(value.id,value);
  }
  return [...byId.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export function refreshPosReport(report,sync) {
  if(report.branch!=='Liloan'||!sync||report.date<sync.startDate)return report;
  const rows=(sync.rows||[]).filter(r=>r.date===report.date&&r.shiftId===report.shiftId);
  const cashRows=rows.filter(r=>r.type==='Cash'), cokeRows=rows.filter(r=>r.type==='Coke');
  const total=values=>values.reduce((sum,r)=>sum+Math.round(r.amount*100),0)/100;
  const next={...report,posRedemptions:{source:'FuelTech POS',station:'YTL',status:sync.status,verifiedAt:sync.verifiedAt||'',attemptedAt:sync.attemptedAt,cashTotal:total(cashRows),cashCount:cashRows.length,cokeTotal:total(cokeRows),cokeQuantity:cokeRows.reduce((sum,r)=>sum+r.quantity,0),rows}};
  next.integrationIssues=[...(report.integrationIssues||[]).filter(i=>i.source!=='FuelTech POS'),...posRedemptionIssues(next)];
  // Imported evidence never reallocates deductions, cash counts, prices or posted balances.
  if(next.confirmed) {
    next.checkDetails=[...(report.checkDetails||[]).filter(i=>i.source!=='FuelTech POS'),...posRedemptionIssues(next)];
    next.checkCategories=[...new Set(next.checkDetails.map(i=>i.category))];next.checkRequired=!!next.checkDetails.length;
  }
  return next;
}
export async function refreshPosEvidence(state,{enabled,read=readPosRedemptions,now=new Date().toISOString(),force=false}={}) {
  if(!enabled) {
    if(state.posRedemptionSync&&state.posRedemptionSync.status!=='disabled')state.posRedemptionSync.status='disabled';
  } else if(force||!state.posRedemptionSync?.attemptedAt||Date.parse(now)-Date.parse(state.posRedemptionSync.attemptedAt)>60000) {
    const previous=state.posRedemptionSync;
    try {
      const rows=await read(state.startDate,accountingTiming(now).date);
      const fingerprint=createHash('sha256').update(JSON.stringify(rows)).digest('hex');
      state.posRedemptionSync={status:'verified',startDate:state.startDate,verifiedAt:now,attemptedAt:now,rows,fingerprint};
      if(previous?.fingerprint!==fingerprint)state.audit.push({id:randomUUID(),at:now,action:'pos-redemptions-read',role:'System',branch:'Liloan',count:rows.length,source:'FuelTech POS',fingerprint});
    } catch(error) {
      state.posRedemptionSync={...previous,startDate:state.startDate,status:'unavailable',attemptedAt:now};
      if(previous?.status!=='unavailable')state.audit.push({id:randomUUID(),at:now,action:'pos-redemptions-unavailable',role:'System',branch:'Liloan',source:'FuelTech POS',code:/^[A-Z0-9_]{1,40}$/.test(error.code||'')?error.code:'POS_READ_FAILED'});
    }
  }
  for(const [key,report] of Object.entries(state.reports))state.reports[key]=refreshPosReport(report,state.posRedemptionSync);
}
