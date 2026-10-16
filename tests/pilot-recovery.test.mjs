import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveRecovery} from '../pilot/recovery.mjs';

function fakeDatabase({failAt=0}={}){
 const entries=Array.from({length:231},(_,i)=>({mode:'live',revision:i+1,patch:{audit:[],upserts:[],removals:[]},created_at:'2026-10-16T01:00:00Z'}));
 return {rpc:async()=>({data:231,error:null}),from(table){
  let rows=table==='fueltech_pilot_heads'?[{mode:'live',revision:231}]:table==='fueltech_pilot_state_legacy'?[{mode:'live',revision:0,data:{audit:[{id:'preserved'}]},updated_at:'2026-10-16'}]:entries;
  let single=false,cursor=0;
  const query={select(){return query;},eq(column,value){rows=rows.filter(r=>r[column]===value);return query;},gt(column,value){cursor=value;rows=rows.filter(r=>r[column]>value);return query;},lte(column,value){rows=rows.filter(r=>r[column]<=value);return query;},gte(column,value){rows=rows.filter(r=>Date.parse(r[column])>=Date.parse(value));return query;},order(){return query;},limit(n){rows=rows.slice(0,n);return query;},maybeSingle(){single=true;return query;},then(resolve){resolve({data:single?rows[0]:rows,error:failAt&&cursor>=failAt?{message:'offline'}:null});}};
  return query;
 }};
}
test('nightly recovery exports the baseline and every journal page with identical retry bytes',async()=>{
 const files=new Map();let writes=0;
 const archive=async(path,bytes)=>{writes++;if(files.has(path))assert.equal(files.get(path),bytes.toString());else files.set(path,bytes.toString());return {path};};
 const first=await archiveRecovery(fakeDatabase(),'2026-10-16',archive);
 const repeated=await archiveRecovery(fakeDatabase(),'2026-10-16',archive);
 assert.deepEqual(repeated,first);assert.equal(writes,8);assert.equal(files.size,4);
 const journal=[...files.values()].map(v=>JSON.parse(v)).flatMap(v=>v.entries||[]);
 assert.equal(journal.length,231);assert.deepEqual(journal.map(r=>r.revision),Array.from({length:231},(_,i)=>i+1));
 assert.equal(JSON.parse(files.get('journals/baselines/live/0.json')).baseline.data.audit[0].id,'preserved');
});
test('nightly recovery fails closed on an incomplete journal export',async()=>{
 await assert.rejects(archiveRecovery(fakeDatabase({failAt:100}),'2026-10-16',async path=>({path})),/journal could not be verified/);
});
