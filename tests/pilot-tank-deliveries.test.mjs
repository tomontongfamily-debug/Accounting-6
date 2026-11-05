import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runAction} from '../pilot/service.mjs';
import {fixture} from './pilot-fixture.mjs';
import {mergeDeliverySave} from '../src/tank-deliveries.js';
import {execute} from '../pilot/repository.mjs';
import {stationLoadFixture} from './pilot-station-load-fixture.mjs';

const delivery=()=>({id:randomUUID(),driverName:'Test Driver',product:'Diesel',liters:3000,time:'10:30'});
const load=()=>({id:randomUUID(),driverName:'Test Driver',time:'10:30',items:[{product:'Regular',liters:5000},{product:'Diesel',liters:1000},{product:'Premium',liters:2000}]});
test('one physical delivery saves all three fuels atomically and a retry cannot double any tank',async()=>{
 const {state,key,cashier}=fixture(),entry=load(),before=structuredClone(state.reports[key]);
 const out=await runAction(state,cashier,'/api/demo/delivery-save',{reportKey:key,delivery:entry});
 assert.equal(out.result.report.pilotRevision,1);assert.equal(out.result.report.deliveries.length,3);
 assert.equal(new Set(out.result.report.deliveries.map(d=>d.deliveryId)).size,1);
 for(const item of entry.items)assert.equal(out.result.report.tankRows.find(row=>row.product===item.product).delivery,item.liters);
 assert.deepEqual(out.result.report.pumpRows,before.pumpRows);assert.equal(out.result.report.actualCashCounted,before.actualCashCounted);
 assert.equal(out.state.audit.filter(row=>row.action==='tank-delivery-saved').length,1);
 const retry=await runAction(out.state,cashier,'/api/demo/delivery-save',{reportKey:key,delivery:entry});
 assert.equal(retry.changed,false);assert.deepEqual(retry.result.report.deliveries,out.result.report.deliveries);
 await assert.rejects(runAction(out.state,cashier,'/api/demo/delivery-save',{reportKey:key,delivery:{...entry,items:entry.items.slice(0,2)}}),e=>e.status===409);
 await assert.rejects(runAction(out.state,cashier,'/api/demo/delivery-save',{reportKey:key,delivery:{...entry,id:randomUUID()}}),e=>e.status===409);
 const draft=await runAction(out.state,cashier,'/api/reports/save',{report:{...out.result.report,notes:'After delivery'}});
 assert.equal(draft.result.report.deliveries.length,3);assert.equal(draft.result.report.tankRows.find(row=>row.product==='Premium').delivery,2000);
});
test('an invalid fuel or existing delivery rejects the whole load before saving any stock',async()=>{
 const {state,key,cashier}=fixture(),entry=load();
 for(const items of [[],[...entry.items,{product:'Regular',liters:10}],[...entry.items.slice(0,2),{product:'Premium',liters:-5}],[{product:'Diesel',liters:true}],[{product:'Water',liters:1000}]]){
  await assert.rejects(runAction(state,cashier,'/api/demo/delivery-save',{reportKey:key,delivery:{...entry,items}}));
  assert.equal((state.reports[key].deliveries||[]).length,0);assert.ok(state.reports[key].tankRows.every(row=>row.delivery===0));
 }
 const existing=await runAction(state,cashier,'/api/demo/delivery-save',{reportKey:key,delivery:{...delivery(),liters:1000}});
 await assert.rejects(runAction(existing.state,cashier,'/api/demo/delivery-save',{reportKey:key,delivery:entry}),e=>e.status===409);
 assert.equal(existing.state.reports[key].deliveries.length,1);assert.equal(existing.state.reports[key].tankRows.find(row=>row.product==='Regular').delivery,0);
});
test('a delivery appends to fresh stock, retains legacy deliveries and never changes photos or cash',async()=>{
 const {state,key,cashier}=fixture();
 state.reports[key].deliveries=[{id:'old',product:'Diesel',liters:500,time:'08:00',reference:'DR-123'}];
 state.reports[key].cashCountConfirmed=true;state.reports[key].actualCashCounted=2500;
 state.reports[key].pumpRows[0].photo_path='saved-photo';
 const original=structuredClone(state.reports[key]),entry=delivery();
 const out=await runAction(state,cashier,'/api/demo/delivery-save',{reportKey:key,delivery:entry});
 const saved=out.state.reports[key];assert.equal(saved.deliveries.length,2);assert.equal(saved.tankRows.find(r=>r.product==='Diesel').delivery,3500);
 assert.equal(saved.actualCashCounted,2500);assert.deepEqual(saved.pumpRows,original.pumpRows);assert.equal(saved.pilotLastNonReadingRevision,1);
 const retry=await runAction(out.state,cashier,'/api/demo/delivery-save',{reportKey:key,delivery:entry});
 assert.equal(retry.changed,false);assert.equal(retry.result.alreadyRecorded,true);assert.equal(retry.result.report.deliveries.length,2);
 await assert.rejects(runAction(out.state,cashier,'/api/demo/delivery-save',{reportKey:key,delivery:{...entry,id:randomUUID()}}),/already recorded/);
 const second=await runAction(out.state,cashier,'/api/demo/delivery-save',{reportKey:key,delivery:{...delivery(),time:'14:30'}});
 assert.equal(second.state.reports[key].tankRows.find(r=>r.product==='Diesel').delivery,6500);
});
test('delivery permissions, invalid values and locked reports remain enforced',async()=>{
 const {state,key,cashier,manager}=fixture();
 await assert.rejects(runAction(state,manager,'/api/demo/delivery-save',{reportKey:key,delivery:delivery()}),e=>e.status===403);
 await assert.rejects(runAction(state,{role:'Cashier',branch:'Mabolo'},'/api/demo/delivery-save',{reportKey:key,delivery:delivery()}),e=>e.status===403);
 for(const patch of [{driverName:''},{liters:-1},{liters:true},{time:'25:01'},{product:'Water'}])await assert.rejects(runAction(state,cashier,'/api/demo/delivery-save',{reportKey:key,delivery:{...delivery(),...patch}}));
 for(const patch of [{confirmed:true},{baselineReport:true},{baselineMissing:true}]){
  const locked=structuredClone(state);Object.assign(locked.reports[key],patch);
  await assert.rejects(runAction(locked,cashier,'/api/demo/delivery-save',{reportKey:key,delivery:delivery()}),e=>e.status===423);
 }
});
test('delivery saves keep intervening manual edits and stale full drafts cannot erase received stock',async()=>{
 const {state,report,key,cashier}=fixture();
 const edited=await runAction(state,cashier,'/api/reports/save',{report:{...report,notes:'Other PC',oilSales:123}});
 const out=await runAction(edited.state,cashier,'/api/demo/delivery-save',{reportKey:key,delivery:delivery()});
 assert.equal(out.result.report.notes,'Other PC');assert.equal(out.result.report.oilSales,123);
 const stale=mergeDeliverySave(report,out.result);assert.equal(stale.pilotRevision,report.pilotRevision);
 await assert.rejects(runAction(out.state,cashier,'/api/reports/save',{report:stale}),e=>e.status===409);
 const draft={...out.result.report,deliveries:[],notes:'Current edit'};
 const saved=await runAction(out.state,cashier,'/api/reports/save',{report:draft});
 assert.equal(saved.result.report.deliveries.length,1);assert.equal(saved.result.report.tankRows.find(r=>r.product==='Diesel').delivery,3000);
});
test('delivered stock saves without importing unrelated offline payments or vouchers',async()=>{
 for(const incremental of [true,false]){
  const f=stationLoadFixture({incremental});f.state.sourcesVerifiedAt='2026-01-01T00:00:00Z';
  const report=Object.values(f.state.reports).find(r=>r.branch==='Liloan'&&!r.confirmed&&r.date>=f.state.startDate);
  assert.ok(report);
  Object.assign(report,{baselineConfirmed:true,baselineMissing:false});
  const result=await execute({role:'Cashier',branch:'Liloan'},{route:'/api/demo/delivery-save',input:{reportKey:`${report.branch}__${report.date}__${report.shiftId}`,delivery:delivery()},mode:'live',startDate:f.state.startDate,mutationId:randomUUID()},f);
  assert.equal(result.ok,true);assert.equal(result.report.deliveries.length,1);assert.equal(f.stats.fullLoads,0);assert.equal(f.stats.posReads,0);
 }
});
