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
      if(!['rows','points','_deferred','_window'].includes(key))add('pos',key,value);
    }
    for(const kind of ['rows','points']) {
      const values=state.posRedemptionSync[kind];
      if(!Array.isArray(values))continue;
      const ids=new Set();
      for(const row of values) {
        if(!row.id||ids.has(row.id))throw Error('POS evidence IDs must be unique.');
        ids.add(row.id);add('pos_'+kind,String(row.id),row);
      }
      const window=state.posRedemptionSync._window;
      const replaced=new Set(window?.loaded[kind]||[]);
      const order=window ? [...(window.order[kind]||[]).filter(id=>!replaced.has(id)),...ids].sort() : [...ids];
      add('shape',kind,order);
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
// Cache immutable snapshots only after checking the committed revision on every
// request. Concurrent devices share one reconstruction; callers always receive
// separate objects so a draft/action cannot change another request's snapshot.
const snapshots=new WeakMap();
const CACHE_LIMIT=6;
export function applyCompactDelta(snapshot,delta) {
  const result=structuredClone(snapshot),state=result.data;
  const apply=({section,key,data},remove=false)=>{
    if(section==='root'){if(remove)delete state[key];else state[key]=data;}
    else if(section==='reports'||section==='photos'){if(remove)delete state[section][key];else state[section][key]=data;}
    else if(section==='pos'){
      state.posRedemptionSync||={_deferred:true};
      if(remove)delete state.posRedemptionSync[key];else state.posRedemptionSync[key]=data;
    }
  };
  for(const item of delta.removals)apply(item,true);
  for(const item of delta.upserts)apply(item);
  const shape=delta.upserts.find(r=>r.section==='shape'&&r.key==='pos');
  if(shape?.data==='missing')delete state.posRedemptionSync;
  else if(shape?.data==='null')state.posRedemptionSync=null;
  else if(shape?.data==='object')state.posRedemptionSync={...state.posRedemptionSync,_deferred:true};
  result.revision=delta.revision;
  return result;
}
export async function loadState(db,mode,{audit=false,before=null,fullPos=false,cache=false}={}) {
  const options={p_mode:mode,p_audit_limit:audit?100:0,p_before:before};
  const read=async()=>{
    const result=await db.rpc(fullPos?'fueltech_pilot_load_v2':'fueltech_pilot_load_compact',options);
    if(result.error)throw Object.assign(Error('Unable to load verified station records.'),{status:503,code:'STATION_RECORDS_UNAVAILABLE'});
    return result.data;
  };
  if(!cache)return read();
  const head=await db.from('fueltech_pilot_heads').select('revision').eq('mode',mode).maybeSingle();
  if(head.error)throw Object.assign(Error('Unable to verify the current station revision.'),{status:503});
  if(!head.data)return null;
  let entries=snapshots.get(db);
  if(!entries){entries=new Map();snapshots.set(db,entries);}
  const key=JSON.stringify([mode,Number(head.data.revision),audit,before,fullPos]);
  let entry=entries.get(key);
  if(!entry){
    const prior=!audit&&!fullPos&&before===null ? [...entries.values()].filter(e=>e.mode===mode&&e.compact&&e.value&&e.value.revision<Number(head.data.revision)).sort((a,b)=>b.value.revision-a.value.revision)[0] : null;
    const promise=(async()=>{
      if(prior){
        const delta=await db.rpc('fueltech_pilot_load_delta',{p_mode:mode,p_since:prior.value.revision});
        if(delta.error)throw Object.assign(Error('Unable to load changed station records.'),{status:503});
        if(delta.data&&!delta.data.full)return applyCompactDelta(prior.value,delta.data);
      }
      return read();
    })();
    entry={mode,compact:!audit&&!fullPos&&before===null,promise};entries.set(key,entry);
    promise.then(value=>{entry.value=value;},()=>{});
    while(entries.size>CACHE_LIMIT)entries.delete(entries.keys().next().value);
    // A failed reconstruction must be retried, never served as a successful read.
    promise.catch(()=>{if(entries.get(key)===entry)entries.delete(key);});
  }
  const result=await entry.promise;
  if(!result||Number(result.revision)<Number(head.data.revision)){
    entries.delete(key);throw Object.assign(Error('The station changed while loading. Refresh to load the saved shift.'),{status:503});
  }
  return structuredClone(result);
}
