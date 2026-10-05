import test from 'node:test';
import assert from 'node:assert/strict';
import {loadStorePages} from '../src/store-pages.js';
import {storePage,sendStoreJson} from '../api/_shared/store-page.js';
import {gunzipSync} from 'node:zlib';

test('Large report rows split by bytes and keep the rest available at the next cursor',()=>{
 const reports=Array.from({length:80},(_,i)=>({report_key:String(i).padStart(3,'0'),data:{notes:'a'.repeat(40000)}}));
 const first=storePage(reports,[]);assert.ok(first.reportRows.length<80);assert.ok(Buffer.byteLength(JSON.stringify(first))<2*1024*1024);
 const second=storePage(reports.filter(row=>row.report_key>first.nextCursor),[]);
 assert.deepEqual([...first.reportRows,...second.reportRows],reports);assert.equal(second.nextCursor,null);
});
test('A later page failure rejects the entire store before any missing status can be displayed',async()=>{
 let calls=0;
 await assert.rejects(loadStorePages(async()=>{if(calls++)throw Error('offline');return {reportRows:[{report_key:'one'}],priceRows:[],nextCursor:'one'};}),/offline/);
 await assert.rejects(loadStorePages(async()=>({reportRows:[{report_key:'one'}],priceRows:[],nextCursor:'one'})),/all saved report pages/);
});
test('Older servers returning a single complete store remain compatible',async()=>{
 const rows={reportRows:[{report_key:'one'}],priceRows:[]};assert.deepEqual(await loadStorePages(async()=>rows),rows);
});

test('Loading progress reports complete page counts without exposing a partial store',async()=>{
 const progress=[];
 const pages=[{reportRows:[{report_key:'one'}],priceRows:[],nextCursor:'one'},{reportRows:[{report_key:'two'}],priceRows:[]}];
 const result=await loadStorePages(async()=>pages.shift(),count=>progress.push(count));
 assert.deepEqual(progress,[1,2]);
 assert.deepEqual(result.reportRows.map(row=>row.report_key),['one','two']);
});

test('A stalled page aborts and reports a recoverable timeout instead of waiting forever',async()=>{
 let signal;
 await assert.rejects(loadStorePages((_, requestSignal)=>{
  signal=requestSignal;
  return new Promise(()=>{});
 },()=>{}, {timeoutMs:5}), /Loading reports took too long/);
 assert.equal(signal.aborted,true);
});
test('Already-open clients can receive complete histories above the uncompressed response limit',()=>{
 const payload={ok:true,reportRows:Array.from({length:1221},(_,i)=>({report_key:String(i),data:{notes:'a'.repeat(6000)}})),priceRows:[]};
 assert.ok(Buffer.byteLength(JSON.stringify(payload))>4.5*1024*1024);
 const headers={},res={setHeader(key,value){headers[key]=value;},status(code){assert.equal(code,200);return this;},end(bytes){this.bytes=bytes;}};
 sendStoreJson({headers:{'accept-encoding':'gzip, deflate, br'}},res,payload);
 assert.equal(headers['Content-Encoding'],'gzip');assert.ok(res.bytes.length<4.5*1024*1024);assert.deepEqual(JSON.parse(gunzipSync(res.bytes)),payload);
});
