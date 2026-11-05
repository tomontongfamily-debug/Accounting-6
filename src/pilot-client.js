const savedRevisions=new Map();
const pendingReports=new Map();
const REQUEST_TIMEOUT_MS=30000;
// Match the read-only actions in pilot/repository.mjs. Unknown actions remain
// conservative: a timeout can leave their save result uncertain.
const READ_ONLY_ROUTES=new Set(['/api/store/load','/api/prices/load','/api/realtime/config','/api/reports/lease','/api/demo/pump-report','/api/demo/deposits','/api/demo/audit','/api/admin/system-health']);

async function request(options,readOnly) {
  const controller=new AbortController();
  let timer;
  try {
    // Bound both the connection and the response body. A hung fetch must not
    // leave the report's save queue (and every later cash action) blocked.
    return await Promise.race([
      (async()=>{
        const response=await fetch('/api/pilot/action',{...options,signal:controller.signal});
        return {response,result:await response.json()};
      })(),
      new Promise((_,reject)=>{
        timer=setTimeout(()=>{
          const message=readOnly?'The station server took too long to load the saved information. Please retry loading.':'The station server took too long to respond. Your save may have completed. Refresh the saved shift before trying again.';
          reject(Object.assign(new Error(message),{code:'PILOT_REQUEST_TIMEOUT',status:408,saveUncertain:!readOnly}));
          controller.abort();
        },REQUEST_TIMEOUT_MS);
      }),
    ]);
  } catch(error){
    // Network and invalid-body failures can happen after a mutation commits.
    error.saveUncertain=!readOnly;throw error;
  } finally {clearTimeout(timer);}
}

export function pilotPost(route,input={},sessionToken='',{mutationId=crypto.randomUUID()}={}) {
  const cfg=window.__fueltechPilotConfig;
  const reportKey=input.report?`${input.report.branch}__${input.report.date}__${input.report.shiftId}`:input.reportKey;
  const key=reportKey?`${cfg?.mode}:${cfg?.start_date}:${reportKey}`:'';
  const snapshot=structuredClone(input);
  // Cash buttons and draft autosaves must observe each other's completed save.
  // Separate reports remain independent; failed requests do not stall the queue.
  if(!key)return post(route,snapshot,sessionToken,key,mutationId);
  const request=(pendingReports.get(key)||Promise.resolve()).catch(()=>{}).then(()=>post(route,snapshot,sessionToken,key,mutationId));
  pendingReports.set(key,request);
  request.finally(()=>{if(pendingReports.get(key)===request)pendingReports.delete(key);}).catch(()=>{});
  return request;
}
async function post(route,input,sessionToken,key,mutationId) {
  const cfg=window.__fueltechPilotConfig;
  if(!cfg||cfg.mode==='disabled') throw Error('The pilot is not enabled.');
  if(input.report) {
    input={...input,report:{...input.report,pilotRevision:Math.max(Number(input.report.pilotRevision||0),savedRevisions.get(key)||0)}};
  }
  const envelope={route,input,mode:cfg.mode,startDate:cfg.start_date,mutationId};
  // The identical request ID is reused after an interrupted response.
  const options={method:'POST',headers:{'Content-Type':'application/json',...(sessionToken&&sessionToken!=='cookie'?{'x-fueltech-session':sessionToken}:{})},body:JSON.stringify(envelope)};
  let response,result;
  for(let attempt=0;attempt<2;attempt++) {
    try {({response,result}=await request(options,READ_ONLY_ROUTES.has(route)));}
    catch(error){
      // A timed-out mutation may still be running. Reload authoritative state
      // before another attempt instead of launching a second expensive check.
      if(error.code==='PILOT_REQUEST_TIMEOUT'||attempt===1)throw error;
      continue;
    }
    // A failed state reconstruction happened before the action ran. Retrying
    // it immediately adds another expensive query to an overloaded database.
    if(response.status!==503||result.code==='STATION_RECORDS_UNAVAILABLE'||attempt===1) break;
  }
  if(!response.ok||result.ok===false) throw Object.assign(new Error(result.error||'Save could not be verified.'),{...result,status:response.status});
  if(route==='/api/demo/cash-confirm') {
    // Cash confirmation can read a newer shift without accepting this full draft.
    // A queued old draft must not inherit that revision and overwrite other edits.
    savedRevisions.delete(key);
  } else if(result.report && route!=='/api/demo/pump-report') {
    const r=result.report;
    savedRevisions.set(key,Number(r.pilotRevision||0));
  }
  return result;
}
