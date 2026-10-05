import test from 'node:test';
import assert from 'node:assert/strict';
import {allPages} from '../api/_shared/pages.js';
import {buildDailyHealth} from '../api/_shared/health.js';

test('Admin loads submitted reports beyond the first 1,000 records',async()=>{
 const historical=Array.from({length:1215},(_,i)=>({report_key:`old-${String(i).padStart(4,'0')}`,data:{confirmed:true}}));
 const recent=['2026-10-03','2026-10-04'].flatMap(date=>['shift-1','shift-2','shift-3'].map(shiftId=>({report_key:`Liloan__${date}__${shiftId}`,data:{branch:'Liloan',date,shiftId,confirmed:true}})));
 const rows=[...historical,...recent],ranges=[];
 const loaded=await allPages(()=>({range:async(from,to)=>{ranges.push([from,to]);return {data:rows.slice(from,to+1)};}}));
 assert.equal(loaded.length,1221);assert.deepEqual(ranges,[[0,999],[1000,1999]]);
 for(const date of ['2026-10-03','2026-10-04']){
  const station=buildDailyHealth({reportRows:loaded,date}).stations.find(row=>row.branch==='Liloan');
  assert.equal(station.submitted,3);assert.equal(station.missing,0);
 }
});
test('A failed later page cannot turn submitted reports into missing ones',async()=>{
 let calls=0;
 await assert.rejects(allPages(()=>({range:async()=>++calls===1?{data:Array(1000).fill({})}:{error:Error('network unavailable')}})),/network unavailable/);
});
