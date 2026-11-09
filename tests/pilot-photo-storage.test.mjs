import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {persistPumpPhoto} from '../pilot/photo-storage.mjs';
import {runAction} from '../pilot/service.mjs';
import {fixture} from './pilot-fixture.mjs';

test('private uploads retain report/nozzle provenance and identical retries verify the original bytes',async()=>{
 const bytes=Buffer.from([255,216,255,217]),files=new Map(),backups=[];
 const context={reportKey:'Barili__2026-11-05__shift-1',rowId:'test-nozzle',branch:'Barili',readingRevision:2};
 let uploads=0;
 const bucket={async list(folder,{search}){return{data:[...files.keys()].filter(p=>p===folder+'/'+search).map(()=>({name:search}))};},async upload(path,image,options){uploads++;assert.equal(options.upsert,false);if(files.has(path))return{error:{code:'Duplicate'}};files.set(path,{image,options});return{};},async download(path){return{data:new Blob([files.get(path).image])};}};
 const db={storage:{from(name){assert.equal(name,'fueltech-pilot-photos');return bucket;}}};
 const archive=async(path,image)=>backups.push({path,image});
 await persistPumpPhoto(db,'live/Barili/test.jpg',bytes,context,archive);
 await persistPumpPhoto(db,'live/Barili/test.jpg',bytes,context,archive);
 assert.equal(files.size,1);assert.equal(backups.length,2);
 assert.deepEqual(files.get('live/Barili/test.jpg').options.metadata,{...context,sha256:createHash('sha256').update(bytes).digest('hex')});
 await assert.rejects(persistPumpPhoto(db,'live/Barili/test.jpg',Buffer.from([255,216,0,0]),context,archive),e=>e.status===503);
 assert.equal(backups.length,2,'Different bytes never replace an existing capture or its backup');
 assert.equal(uploads,1,'Existing photos are verified without a duplicate upload attempt');
});

test('photo provenance comes from the server-validated report and nozzle',async()=>{
 const {state,key,report,cashier}=fixture();let saved;
 const id=randomUUID(),row=report.pumpRows[0];
 await runAction(state,cashier,'/api/demo/photo',{reportKey:key,rowId:row.id,replaceReading:true,revision:0,data:'data:image/jpeg;base64,/9j/2Q=='},{mutationId:id,uploadPhoto:async(path,image,context)=>{saved={path,image,context};}});
 assert.equal(saved.path,`shadow/Liloan/${id}.jpg`);
 assert.equal(saved.context.reportKey,key);assert.equal(saved.context.rowId,row.id);assert.equal(saved.context.branch,'Liloan');assert.equal(saved.context.readingRevision,0);
 assert.ok(Number.isFinite(Date.parse(saved.context.uploadedAt)));
});
