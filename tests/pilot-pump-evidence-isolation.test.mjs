import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execute} from '../pilot/repository.mjs';
import {runAction} from '../pilot/service.mjs';
import {accountingTiming,dateOffset} from '../pilot/integrations.mjs';
import {createReport,reportKey} from '../src/accounting-engine.js';
import {midShiftPumpKey} from '../src/mid-shift-price-change.js';
import {stationLoadFixture} from './pilot-station-load-fixture.mjs';

function evidenceFixture({incremental=true,branch='Liloan',conflict=false}={}){
 const f=stationLoadFixture({incremental}),date=accountingTiming(new Date().toISOString()).date;
 f.state.sourcesVerifiedAt='2026-10-03T00:00:00Z';
 const prices={Premium:70,Regular:65,Diesel:60};
 const preceding=createReport(branch,dateOffset(date,-1),prices,'shift-3');
 Object.assign(preceding,{confirmed:true,baselineConfirmed:true,baselineMissing:false});
 preceding.pumpRows=preceding.pumpRows.map(r=>({...r,opening:123450,closing:123450,closingEntered:true}));
 f.state.reports[reportKey(branch,preceding.date,preceding.shiftId)]=preceding;
 const report=createReport(branch,date,prices,'shift-1');
 Object.assign(report,{baselineConfirmed:true,baselineMissing:false,cashierName:'Test cashier'});
 report.pumpRows=report.pumpRows.map(r=>({...r,opening:123450}));
 if(branch==='Liloan'){
  f.state.posRedemptionSync.rows=f.state.posRedemptionSync.rows.map(r=>({...r,date,shiftId:'shift-1'}));
  f.state.posRedemptionSync.points=f.state.posRedemptionSync.points.map(r=>({...r,date,shiftId:'shift-1'}));
  report.posRedemptions={automatic:true,source:'FuelTech POS',status:'verified',cashTotal:77,pointsStatus:'verified',pointsTotal:11};
  report.deductions.posRedemption=77;report.pointsWithdrawn=77;report.pointsIssued=11;
 }
 const key=reportKey(branch,date,'shift-1');f.state.reports[key]=report;
 const stats=Object.assign(f.stats,{sourceReads:0,uploads:0,backups:0,commits:0});
 const from=f.db.from.bind(f.db),rpc=f.db.rpc.bind(f.db),objects=new Map();
 f.db.from=table=>{
  if(!['fueltech_pilot_config','fueltech_pilot_state','fueltech_pilot_receipts','fueltech_pilot_heads'].includes(table)){stats.sourceReads++;throw Error('Financial source server is offline');}
  return from(table);
 };
 f.cvClient={from(){stats.sourceReads++;throw Error('CV source server is offline');}};
 f.db.storage={from(){return{
  async list(folder,{search}){return{data:objects.has(folder+'/'+search)?[{name:search}]:[]};},
  async upload(path,bytes){stats.uploads++;if(objects.has(path))return{error:{message:'Already exists'}};objects.set(path,Buffer.from(bytes));return{error:null};},
  async download(path){return objects.has(path)?{data:new Blob([objects.get(path)]),error:null}:{error:{message:'Missing'}};},
 };}};
 f.backupPhoto=async(path,bytes)=>{stats.backups++;assert.match(path,/^photos\/live\//);assert.deepEqual(Buffer.from(bytes),Buffer.from([255,216,255,217]));};
 f.db.rpc=async(name,params)=>{
  if(!['fueltech_pilot_try_commit_v2','fueltech_pilot_commit'].includes(name))return rpc(name,params);
  stats.commits++;
  if(conflict&&stats.commits===1)return incremental?{data:{committed:false,revision:11}}:{error:{code:'PT409'}};
  if(params.p_data){for(const key of Object.keys(f.state))delete f.state[key];Object.assign(f.state,structuredClone(params.p_data));}
  else{
   for(const row of params.p_patch.upserts){
    if(['reports','photos'].includes(row.section))f.state[row.section][row.key]=structuredClone(row.data);
    else if(row.section==='root')f.state[row.key]=structuredClone(row.data);
   }
   f.state.audit.push(...structuredClone(params.p_patch.audit));
  }
  return{data:incremental?{committed:true,revision:params.p_revision+1,result:params.p_result}:params.p_result};
 };
 const call=(route,input,options={})=>execute({role:route==='/api/demo/midshift-reading'||input?.changeId?'Manager':'Cashier',branch},{route,input,mode:'live',startDate:f.state.startDate,mutationId:randomUUID()}, {...f,...options});
 return {...f,key,report,stats,call};
}

for(const incremental of [false,true])for(const branch of ['Liloan','Mabolo'])test(`pump photo, suggestion and confirmation bypass offline financial imports (${branch}, incremental=${incremental})`,async()=>{
 const f=evidenceFixture({incremental,branch}),originalSync=structuredClone(f.state.posRedemptionSync);
 const first=f.report.pumpRows[0];
 const photo=await f.call('/api/demo/photo',{reportKey:f.key,rowId:first.id,data:'data:image/jpeg;base64,/9j/2Q==',replaceReading:true,revision:0});
 assert.ok(photo.photo_path);assert.equal(photo.readingRevision,1);
 const cleared=photo.report.pumpRows[0];assert.equal(cleared.readingConfirmed,false);assert.equal(cleared.closing,'');
 const suggestion=await f.call('/api/demo/pump-reading',{reportKey:f.key,revision:photo.readingRevision,row:{...cleared,ocr_detected_reading:123460,ocr_result:{status:'detected',version:'isolation-test'}}});
 const suggested=suggestion.report.pumpRows[0];assert.equal(suggested.ocr_detected_reading,123460);assert.equal(suggested.readingConfirmed,false);
 const saved=await f.call('/api/demo/pump-reading',{reportKey:f.key,revision:suggested.readingRevision,row:{...suggested,closing:123460,closingEntered:true,readingConfirmed:true}});
 assert.equal(saved.report.pumpRows[0].closing,123460);assert.equal(saved.report.pumpRows[0].readingConfirmed,true);
 const loaded=await f.call('/api/demo/pump-report',{reportKey:f.key});
 assert.equal(loaded.report.pumpRows[0].closing,123460);
 assert.equal(f.stats.uploads,1);assert.equal(f.stats.backups,1);assert.equal(f.stats.sourceReads,0);
 assert.equal(f.stats.commits,3);assert.equal(f.stats.fullLoads,0);assert.equal(f.stats.posReads,0);
 assert.deepEqual(f.state.posRedemptionSync,originalSync);
 assert.equal(f.state.sourcesVerifiedAt,'2026-10-03T00:00:00Z','A pump save must not claim that sources were refreshed');
 if(branch==='Liloan'){assert.equal(saved.report.deductions.posRedemption,77);assert.equal(saved.report.pointsIssued,11);}
});

test('manager price-change photos and readings are independent of offline cash sources',async()=>{
 const f=evidenceFixture(),row=f.report.pumpRows[0],change={id:'price-test',product:row.product,effectiveTime:'09:00',newPrice:71,readings:{},readingPhotos:{}};
 f.report.midShiftPriceChanges=[change];
 const photo=await f.call('/api/demo/photo',{reportKey:f.key,rowId:row.id,pumpKey:midShiftPumpKey(row),changeId:change.id,data:'data:image/jpeg;base64,/9j/2Q==',replaceReading:true,revision:0});
 const saved=await f.call('/api/demo/midshift-reading',{reportKey:f.key,changeId:change.id,product:change.product,effectiveTime:change.effectiveTime,revision:photo.readingRevision,row:{...row,photo_path:photo.photo_path,ocr_detected_reading:123455,readingConfirmed:true,closing:123455}});
 const evidence=saved.report.midShiftPriceChanges[0].readingPhotos[midShiftPumpKey(row)];
 assert.equal(evidence.photo_path,photo.photo_path);assert.equal(evidence.readingConfirmed,true);
 assert.equal(f.stats.sourceReads,0);assert.equal(f.stats.uploads,1);assert.equal(f.stats.backups,1);
 const loaded=await execute({role:'Manager',branch:'Liloan'},{route:'/api/demo/pump-report',input:{reportKey:f.key},mode:'live',startDate:f.state.startDate,mutationId:randomUUID()},f);
 assert.equal(loaded.report.midShiftPriceChanges[0].readingPhotos[midShiftPumpKey(row)].photo_path,photo.photo_path);
 assert.equal(f.stats.sourceReads,0,'Manager photo refresh must not depend on financial source imports');
 await assert.rejects(runAction(f.state,{role:'Manager',branch:'Mabolo'},'/api/demo/pump-report',{reportKey:f.key}),/station/i);
 await assert.rejects(runAction(f.state,{role:'Approver'},'/api/demo/pump-report',{reportKey:f.key}),/role|permission|access/i);
 await assert.rejects(runAction(f.state,{role:'Manager',branch:'Liloan'},'/api/demo/pump-reading',{reportKey:f.key,row}),/role|permission|access/i);
});

test('cash checks, final submission and financial actions still require source verification',async()=>{
 for(const route of ['/api/demo/cash-check','/api/reports/save','/api/demo/deposit-submit']){
  const f=evidenceFixture({branch:route==='/api/demo/deposit-submit'?'Mabolo':'Liloan'});
  await assert.rejects(f.call(route,{reportKey:f.key,report:f.report,operation:'submit'}),/Unrelated Liloan full-history read is unavailable|Financial source server is offline/);
 }
 const f=evidenceFixture({branch:'Mabolo'});
 await assert.rejects(f.call('/api/demo/pump-report',{reportKey:f.key},{forceSources:true}),/Financial source server is offline/);
 assert.ok(f.stats.sourceReads>0,'Explicit source-refresh requests must not be skipped');
 const liloan=evidenceFixture();
 await assert.rejects(liloan.call('/api/demo/pump-report',{reportKey:liloan.key},{forceSources:true}),/Unrelated Liloan full-history read is unavailable/);
});

test('pump photos still require an authoritative station snapshot and correct station access',async()=>{
 const f=evidenceFixture();
 const rpc=f.db.rpc;
 f.db.rpc=(name,params)=>name==='fueltech_pilot_load_compact'?{error:{code:'57014'}}:rpc(name,params);
 await assert.rejects(f.call('/api/demo/photo',{reportKey:f.key,rowId:f.report.pumpRows[0].id,data:'data:image/jpeg;base64,/9j/2Q==',replaceReading:true,revision:0}),e=>e.code==='STATION_RECORDS_UNAVAILABLE');
 assert.equal(f.stats.uploads,0);
 const other=evidenceFixture({branch:'Mabolo'});
 await assert.rejects(execute({role:'Cashier',branch:'Liloan'},{route:'/api/demo/photo',input:{reportKey:other.key,rowId:other.report.pumpRows[0].id,data:'data:image/jpeg;base64,/9j/2Q==',replaceReading:true,revision:0},mode:'live',startDate:other.state.startDate,mutationId:randomUUID()},other),e=>e.status===403);
 assert.equal(other.stats.uploads,0);
});

test('a photo commit conflict retries with immutable upload evidence and still skips unrelated imports',async()=>{
 const f=evidenceFixture({conflict:true});
 const photo=await f.call('/api/demo/photo',{reportKey:f.key,rowId:f.report.pumpRows[0].id,data:'data:image/jpeg;base64,/9j/2Q==',replaceReading:true,revision:0});
 assert.ok(photo.photo_path);assert.equal(f.stats.uploads,1);assert.equal(f.stats.backups,1);assert.equal(f.stats.commits,2);assert.equal(f.stats.sourceReads,0);
});

test('a retry revalidates a nozzle changed by another device before reusing photo evidence',async()=>{
 const f=evidenceFixture(),row=f.report.pumpRows[0],rpc=f.db.rpc;
 let commits=0;
 f.db.rpc=async(name,params)=>{
  if(name==='fueltech_pilot_try_commit_v2'){
   commits++;f.state.reports[f.key].pumpRows[0].readingRevision=1;
   return{data:{committed:false,revision:11}};
  }
  return rpc(name,params);
 };
 await assert.rejects(f.call('/api/demo/photo',{reportKey:f.key,rowId:row.id,data:'data:image/jpeg;base64,/9j/2Q==',replaceReading:true,revision:0}),e=>e.status===409);
 assert.equal(commits,1);assert.equal(f.stats.uploads,1);assert.equal(f.stats.backups,1);
 assert.equal(f.state.reports[f.key].pumpRows[0].readingRevision,1);
});

test('exhausted contention never acknowledges a saved photo or repeats its verified uploads',async()=>{
 const f=evidenceFixture(),rpc=f.db.rpc;
 let commits=0;
 f.db.rpc=async(name,params)=>{
  if(name==='fueltech_pilot_try_commit_v2'){commits++;return{data:{committed:false,revision:11}};}
  return rpc(name,params);
 };
 await assert.rejects(f.call('/api/demo/photo',{reportKey:f.key,rowId:f.report.pumpRows[0].id,data:'data:image/jpeg;base64,/9j/2Q==',replaceReading:true,revision:0}),e=>e.status===409&&e.retryableConflict===true&&e.saveUncertain===false);
 assert.equal(commits,5);assert.equal(f.stats.uploads,1);assert.equal(f.stats.backups,1);
 assert.equal(Object.keys(f.state.photos).length,0);
});
