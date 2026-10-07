import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { accountingTiming, loadSources } from './integrations.mjs';
import { initialState, ensureCurrentReports, reconcileSources } from './state.mjs';
import { runAction } from './service.mjs';
import { launchStatus } from './launch.mjs';
import { backupImmutable } from './backup.mjs';
import { posEnabled, refreshPosEvidence } from './pos-redemptions.mjs';

const fail=(message,status=503)=>Object.assign(new Error(message),{status});
export const BUCKET='fueltech-pilot-photos';
export function pilotDatabase() {
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!key) throw fail('The Accounting server connection has not been configured.');
  return createClient(process.env.SUPABASE_URL||'https://chqinknijqtixeenhtvu.supabase.co',key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function configuration(db=pilotDatabase()) {
  const {data,error}=await db.from('fueltech_pilot_config').select('mode,start_date').eq('branch','Liloan').single();
  if(error) throw fail('Pilot preparation is not installed. The existing app remains available.');
  return data;
}
// The all-stations Admin page uses the regular report endpoint. Liloan decisions
// must update the live state and its canonical report together, or the next
// station refresh overwrites the approval with the old pending request.
export async function saveLivePilotCorrection(db,session,report,operation) {
  if(session.role!=='Admin'||report.branch!=='Liloan'||!['save','correction-decision'].includes(operation)||!['approved','rejected'].includes(report.correctionRequest?.status))return null;
  const config=await db.from('fueltech_pilot_config').select('mode,start_date').eq('branch','Liloan').maybeSingle();
  if(config.error)throw fail('Unable to verify the Liloan correction workflow.');
  if(config.data?.mode!=='live'||report.date<config.data.start_date)return null;
  return execute(session,{mode:'live',startDate:config.data.start_date,route:'/api/reports/save',input:{report,operation:'correction-decision'},mutationId:randomUUID()},{db});
}
// The existing Admin screen must refresh approved vouchers and delayed payment
// notifications too; importing cannot depend on a cashier opening the pilot.
export async function refreshLivePilotSources(db,session) {
  if(!['Admin','Approver'].includes(session.role)&&session.branch!=='Liloan')return;
  const config=await db.from('fueltech_pilot_config').select('mode,start_date').eq('branch','Liloan').maybeSingle();
  if(config.error)throw fail('Unable to verify Liloan source configuration.');
  if(config.data?.mode!=='live')return;
  const saved=await db.from('fueltech_pilot_state').select('revision').eq('mode','live').maybeSingle();
  if(saved.error)throw fail('Unable to verify Liloan source records.');
  if(!saved.data)return;
  await execute(session,{mode:'live',startDate:config.data.start_date,route:'/api/realtime/config',mutationId:randomUUID()},{db});
}
async function allRows(query) {
  const rows=[];
  for(let offset=0;;offset+=1000) {
    const {data,error}=await query().range(offset,offset+999);
    if(error) throw fail('Unable to verify saved station records.');
    rows.push(...data);if(data.length<1000)return rows;
  }
}
export async function execute(session,envelope,{db=pilotDatabase(),cvClient,posRead,posEnv=process.env,attempt=0}={}) {
  if(!['Admin','Approver','Cashier','Manager'].includes(session.role)||(['Cashier','Manager'].includes(session.role)&&session.branch!=='Liloan')) throw fail('This pilot is restricted to Liloan.',403);
  const config=await configuration(db);
  if(config.mode==='disabled') throw fail('The Liloan pilot has not been enabled.',423);
  if(process.env.VERCEL_ENV==='preview'&&config.mode!=='shadow') throw fail('Preview deployments may only use trial records.',423);
  if(envelope.mode!==config.mode||envelope.startDate!==config.start_date) throw fail('Pilot configuration changed. Reload the page.',409);
  const {route,input={},mutationId}=envelope;
  const readOnly=['/api/store/load','/api/prices/load','/api/realtime/config','/api/reports/lease','/api/demo/pump-report','/api/demo/deposits','/api/demo/audit','/api/admin/system-health'].includes(route);
  if(!/^\/api\/(demo\/|store\/|prices\/|reports\/|realtime\/|admin\/)/.test(route||'')||!/^\w{8}-\w{4}-4\w{3}-[89ab]\w{3}-\w{12}$/i.test(mutationId||'')) throw fail('Invalid pilot request.',400);
  const hash=createHash('sha256').update(JSON.stringify({role:session.role,branch:session.branch,...envelope})).digest('hex');
  const receipt=await db.from('fueltech_pilot_receipts').select('request_hash,result').eq('mode',config.mode).eq('mutation_id',mutationId).maybeSingle();
  if(receipt.error) throw fail('Unable to verify the save receipt.');
  if(receipt.data&&!readOnly) {
    if(receipt.data.request_hash!==hash) throw fail('This save ID was already used for different data.',409);
    return receipt.data.result;
  }
  const loaded=await db.from('fueltech_pilot_state').select('revision,data').eq('mode',config.mode).maybeSingle();
  if(loaded.error) throw fail('Unable to load the pilot records.');
  let state=loaded.data?.data;
  if(state&&(state.mode!==config.mode||state.startDate!==config.start_date)) throw fail('Cutover differs from saved pilot records. Restore or review configuration before continuing.');
  if(!state) {
    const launch=await launchStatus(db,config);
    if(!launch.ready) throw fail(launch.timeReached?'Complete the preceding Shift 3 pump and tank closing readings in the existing app first.':`New Liloan reports begin ${config.start_date} at 4:00 a.m. Manila time.`,423);
    const [reports,prices]=await Promise.all([
      allRows(()=>db.from('fueltech_reports').select('report_key,branch,data').eq('branch','Liloan').order('report_key')),
      allRows(()=>db.from('fueltech_price_book').select('*').eq('branch','Liloan').order('effective_date').order('coverage').order('shift_id')),
    ]);
    // Official cutover may not overwrite an already started shift.
    if(config.mode==='live'&&reports.some(r=>r.data.date>=config.start_date)) throw fail('A report already exists at or after cutover. Review the station boundary before activation.',409);
    state=initialState(reports,prices,config);
  }
  const before=structuredClone(state);
  ensureCurrentReports(state);
  const requiresFresh=route==='/api/demo/cash-check'||(route==='/api/reports/save'&&input.operation==='submit');
  if(requiresFresh||!state.sourcesVerifiedAt||Date.now()-Date.parse(state.sourcesVerifiedAt)>60000) {
    if(!cvClient) {
      if(!process.env.FUELTECH_CV_SERVICE_ROLE_KEY||!process.env.FUELTECH_CV_URL) throw fail('The server CV connection has not been configured.');
      cvClient=createClient(process.env.FUELTECH_CV_URL,process.env.FUELTECH_CV_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    }
    const sources=await loadSources(db,cvClient,state.startDate,accountingTiming(new Date().toISOString()).date);
    reconcileSources(state,sources);
  }
  await refreshPosEvidence(state,{enabled:posEnabled(config.mode,posEnv),read:posRead,force:requiresFresh});
  const outcome=await runAction(state,session,route,input,{mutationId,uploadPhoto:async(path,image)=>{
    const uploaded=await db.storage.from(BUCKET).upload(path,image,{contentType:'image/jpeg',upsert:false});
    if(uploaded.error) {
      // An interrupted response may leave an immutable upload. Verify its bytes before reuse.
      const existing=await db.storage.from(BUCKET).download(path);
      if(existing.error||!Buffer.from(await existing.data.arrayBuffer()).equals(image)) throw fail('Photo could not be saved. Retake or retry.');
    }
    await backupImmutable('photos/'+path,image);
  }});
  if(!loaded.data||outcome.changed||!isDeepStrictEqual(before,JSON.parse(JSON.stringify(outcome.state)))) {
    const saved=await db.rpc('fueltech_pilot_commit',{p_mode:config.mode,p_revision:loaded.data?.revision||0,p_mutation:mutationId,p_hash:hash,p_data:outcome.state,p_result:readOnly?{ok:true}:outcome.result});
    // Re-read and revalidate after aggregate contention. Per-report/nozzle checks still
    // reject stale edits; a concurrent refresh must not make saved reports disappear.
    const conflict=['PT409','40001'].includes(saved.error?.code);
    if(conflict&&attempt<2) {
      await new Promise(resolve=>setTimeout(resolve,50*(attempt+1)));
      return execute(session,envelope,{db,cvClient,posRead,posEnv,attempt:attempt+1});
    }
    if(saved.error) console.error('Pilot commit failed',{code:saved.error.code,message:saved.error.message});
    if(saved.error) throw fail(conflict?'Another device saved first. Refresh and retry.':'The save could not be verified. Retry with the same request.',conflict?409:503);
    return readOnly?outcome.result:saved.data;
  }
  return outcome.result;
}
