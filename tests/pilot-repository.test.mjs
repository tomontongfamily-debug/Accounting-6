import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execute } from '../pilot/repository.mjs';
import { ensureCurrentReports } from '../pilot/state.mjs';
import { fixture } from './pilot-fixture.mjs';

const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;

for(const exhausted of [false,true]) test(`PT409 conflicts re-read the latest state with bounded retries (exhausted=${exhausted})`,async()=>{
  const {state,cashier}=fixture();
  let loads=0;
  const revisions=[];
  const db={from(table){
    const result={data:table==='fueltech_pilot_config'?{mode:'shadow',start_date:state.startDate}:table==='fueltech_pilot_state'?{revision:++loads,data:structuredClone(state)}:null,error:null};
    const query=new Proxy({}, {get:(_target,key)=>key==='then'?(resolve=>resolve(result)):()=>query});
    return query;
  },async rpc(_name,params){
    revisions.push(params.p_revision);
    return exhausted||revisions.length<3?{error:{code:'PT409',message:'Concurrent save: refresh and retry'}}:{data:{ok:true}};
  }};
  const run=()=>execute(cashier,{route:'/api/store/load',mode:'shadow',startDate:state.startDate,mutationId:randomUUID()},{db});
  if(exhausted) await assert.rejects(run(),error=>error.status===409&&/Another device saved first/.test(error.message));
  else assert.ok(await run());
  assert.deepEqual(revisions,[1,2,3]);
  assert.equal(loads,3);
});
test('JSONB key order cannot turn phone and desktop reads into repeated database writes',async()=>{
  const {state,cashier}=fixture();
  ensureCurrentReports(state);ensureCurrentReports(state);
  const data=sorted(JSON.parse(JSON.stringify(state)));
  let commits=0;
  const db={from(table){
    const result={data:table==='fueltech_pilot_config'?{mode:'shadow',start_date:state.startDate}:table==='fueltech_pilot_state'?{revision:10,data}:null,error:null};
    const query=new Proxy({}, {get:(_target,key)=>key==='then'?(resolve=>resolve(result)):()=>query});
    return query;
  },async rpc(){commits++;return {data:{ok:true}};}};
  for(const route of ['/api/store/load','/api/prices/load','/api/store/load','/api/realtime/config']) {
    const result=await execute(cashier,{route,mode:'shadow',startDate:state.startDate,mutationId:randomUUID()},{db});
    assert.ok(result);
  }
  assert.equal(commits,0);
});

test('Refreshing draft reports preserves manager price-change photo evidence',()=>{
  const {state,key}=fixture();
  const evidence=[{id:'price-change',product:'Diesel',effectiveTime:'09:00',newPrice:61,photoRequired:true,confirmedAt:'2026-09-23T02:00:00Z',readings:{nozzle:10005},readingPhotos:{nozzle:{photo_path:'/api/pilot/photo?id=test',readingConfirmed:true,readingRevision:2}}}];
  state.reports[key].midShiftPriceChanges=structuredClone(evidence);
  ensureCurrentReports(state,'2026-09-23T05:00:00Z');
  ensureCurrentReports(state,'2026-09-23T05:01:00Z');
  assert.deepEqual(state.reports[key].midShiftPriceChanges,evidence);
});
