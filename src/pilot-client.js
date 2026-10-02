const savedRevisions=new Map();
export async function pilotPost(route,input={},sessionToken='') {
  const cfg=window.__fueltechPilotConfig;
  if(!cfg||cfg.mode==='disabled') throw Error('The pilot is not enabled.');
  if(input.report) {
    const key=`${input.report.branch}__${input.report.date}__${input.report.shiftId}`;
    input={...input,report:{...input.report,pilotRevision:Math.max(Number(input.report.pilotRevision||0),savedRevisions.get(key)||0)}};
  }
  const envelope={route,input,mode:cfg.mode,startDate:cfg.start_date,mutationId:crypto.randomUUID()};
  // The identical request ID is reused after an interrupted response.
  const options={method:'POST',headers:{'Content-Type':'application/json',...(sessionToken&&sessionToken!=='cookie'?{'x-fueltech-session':sessionToken}:{})},body:JSON.stringify(envelope)};
  let response;
  for(let attempt=0;attempt<2;attempt++) {
    try {response=await fetch('/api/pilot/action',options);}
    catch(error){if(attempt===1)throw error;continue;}
    if(response.status!==503||attempt===1) break;
  }
  const result=await response.json();
  if(!response.ok||result.ok===false) throw Object.assign(new Error(result.error||'Save could not be verified.'),{...result,status:response.status});
  if(result.report && route!=='/api/demo/pump-report') {
    const r=result.report;
    savedRevisions.set(`${r.branch}__${r.date}__${r.shiftId}`,Number(r.pilotRevision||0));
  }
  return result;
}
