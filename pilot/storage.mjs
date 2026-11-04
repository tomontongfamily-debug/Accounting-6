import { isDeepStrictEqual } from 'node:util';

// Keep the representation identical to the SQL splitter. Order lists preserve
// source evidence exactly without rewriting every row when an ID is inserted.
export function documents(state) {
  const rows=[];
  const add=(section,key,data)=>rows.push({section,key,data});
  for(const [key,value] of Object.entries(state)) {
    if(!['reports','photos','audit','posRedemptionSync'].includes(key))add('root',key,value);
  }
  for(const section of ['reports','photos'])for(const [key,value] of Object.entries(state[section]||{}))add(section,key,value);
  add('shape','pos',!Object.hasOwn(state,'posRedemptionSync')?'missing':state.posRedemptionSync===null?'null':'object');
  if(state.posRedemptionSync) {
    for(const [key,value] of Object.entries(state.posRedemptionSync)) {
      if(!['rows','points','_deferred'].includes(key))add('pos',key,value);
    }
    for(const kind of ['rows','points']) {
      const values=state.posRedemptionSync[kind];
      if(!Array.isArray(values))continue;
      const ids=new Set();
      for(const row of values) {
        if(!row.id||ids.has(row.id))throw Error('POS evidence IDs must be unique.');
        ids.add(row.id);add('pos_'+kind,String(row.id),row);
      }
      add('shape',kind,values.map(row=>String(row.id)));
    }
  }
  return rows;
}
const identity=row=>JSON.stringify([row.section,row.key]);
function persistedDocument(old, row) {
  if (row.section !== 'reports' || !old?.data?.posRedemptions || !row.data?.posRedemptions) return row.data;
  // Successful polling times live once in POS sync metadata. Read projections
  // apply them to each report; journal a report only when its content changes.
  const evidence={...row.data.posRedemptions};
  for (const key of ['attemptedAt','verifiedAt']) {
    if (Object.hasOwn(old.data.posRedemptions,key)) evidence[key]=old.data.posRedemptions[key];
    else delete evidence[key];
  }
  const withoutPollingTimes={...row.data,posRedemptions:evidence};
  return isDeepStrictEqual(old.data,withoutPollingTimes) ? old.data : row.data;
}
export function statePatch(before,after) {
  const prior=new Map(documents(before).map(row=>[identity(row),row]));
  const next=documents(after),upserts=[];
  for(const row of next) {
    const id=identity(row),old=prior.get(id);
    if(!old||!isDeepStrictEqual(old.data,persistedDocument(old,row)))upserts.push(row);
    prior.delete(id);
  }
  const oldAudit=before.audit||[],newAudit=after.audit||[];
  if(newAudit.length<oldAudit.length||!isDeepStrictEqual(oldAudit,newAudit.slice(0,oldAudit.length)))throw Error('Saved audit events are immutable.');
  return {upserts,removals:[...prior.values()].map(({section,key})=>({section,key})),audit:newAudit.slice(oldAudit.length)};
}
export async function loadState(db,mode,{audit=false,before=null,fullPos=false}={}) {
  const result=await db.rpc(fullPos?'fueltech_pilot_load_v2':'fueltech_pilot_load_compact',{p_mode:mode,p_audit_limit:audit?100:0,p_before:before});
  if(result.error)throw Object.assign(Error('Unable to load verified station records.'),{status:503});
  return result.data;
}
