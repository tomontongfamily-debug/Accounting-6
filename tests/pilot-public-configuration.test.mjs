import test from 'node:test';
import assert from 'node:assert/strict';
import {publicConfiguration} from '../pilot/public-configuration.mjs';
import {configuration} from '../pilot/repository.mjs';
import {launchStatus} from '../pilot/launch.mjs';
import {configHandler} from '../api/pilot/config.js';

function database(control={}) {
 const reads=[];
 const db={from(table){
  let signal,columns;const query={
   select(value){columns=value;return this;},eq(){return this;},single(){return this;},maybeSingle(){return this;},
   abortSignal(value){signal=value;return this;},
   then(resolve,reject){return Promise.resolve().then(async()=>{
    reads.push({table,columns,signal});
    if(control.hang)return new Promise(()=>{});
    if(control.fail===table)return{error:{code:'57014'}};
    if(table==='fueltech_pilot_config')return{data:{mode:control.mode||'live',start_date:'2026-10-03',storage_version:control.version??2}};
    if(table==='fueltech_pilot_heads'||table==='fueltech_pilot_state')return{data:{revision:1}};
    throw Error('Unexpected read: '+table);
   }).then(resolve,reject);},
  };return query;
 }};
 return{db,reads};
}

test('simultaneous public checks share two small reads; accounting configuration remains fresh',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.parse('2026-11-05T05:00:00Z')});
 const control={}, {db,reads}=database(control);
 const values=await Promise.all(Array.from({length:20},()=>publicConfiguration(db)));
 assert.deepEqual(reads.map(r=>[r.table,r.columns]),[['fueltech_pilot_config','mode,start_date,storage_version'],['fueltech_pilot_heads','revision']]);
 assert.ok(values.every(value=>value.launch.ready&&value.mode==='live'));
 values[0].branches.length=0;
 assert.ok((await publicConfiguration(db)).branches.length>0);
 control.mode='disabled';
 assert.equal((await configuration(db)).mode,'disabled','Accounting actions bypass the short public cache');
 assert.equal((await publicConfiguration(db)).mode,'live');
 t.mock.timers.tick(5000);
 assert.equal((await publicConfiguration(db)).mode,'disabled');
 assert.equal(reads.filter(r=>r.table==='fueltech_pilot_heads').length,1);
});

test('an expired success cannot hide a database failure and the next check can recover',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.parse('2026-11-05T05:00:00Z')});
 const control={}, {db,reads}=database(control);
 await publicConfiguration(db);t.mock.timers.tick(5000);
 control.fail='fueltech_pilot_heads';
 await assert.rejects(publicConfiguration(db),error=>error.code==='57014'&&error.stage==='launch');
 await assert.rejects(publicConfiguration(db),/Unable to verify/);
 assert.equal(reads.filter(r=>r.table==='fueltech_pilot_config').length,3);
 control.fail='';
 assert.equal((await publicConfiguration(db)).launch.ready,true);
});

test('a hung shared read is bounded, aborted and evicted rather than blocking future checks',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.parse('2026-11-05T05:00:00Z')});
 const control={hang:true}, {db,reads}=database(control);
 const pending=[publicConfiguration(db),publicConfiguration(db)];
 const failures=pending.map(p=>assert.rejects(p,error=>error.code==='CONFIG_TIMEOUT'&&error.stage==='configuration'));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(reads.length,1);
 t.mock.timers.tick(10000);await Promise.all(failures);
 assert.equal(reads[0].signal.aborted,true);
 control.hang=false;
 assert.equal((await publicConfiguration(db)).mode,'live');
});

test('incremental launch checks use only the head; legacy launch checks retain their storage path and time gate',async()=>{
 const {db,reads}=database();
 const config={mode:'live',start_date:'2026-10-03',storage_version:2};
 assert.equal((await launchStatus(db,config,new Date('2026-10-03T03:59:59+08:00'))).ready,false);
 assert.equal((await launchStatus(db,config,new Date('2026-10-03T04:00:00+08:00'))).ready,true);
 await launchStatus(db,{...config,storage_version:1});
 assert.deepEqual(reads.map(r=>r.table),['fueltech_pilot_heads','fueltech_pilot_heads','fueltech_pilot_state']);
});

function response(){return{headers:{},setHeader(name,value){this.headers[name]=value;},status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}};}

test('only successful public metadata can enter the CDN cache; errors stay visible and logs exclude private details',async()=>{
 const db={},logs=[];let fail=false,loads=0;
 const handler=configHandler({database:()=>db,load:async client=>{
  assert.equal(client,db);loads++;
  if(fail)throw Object.assign(Error('Private database detail'),{stage:'launch',code:'57014'});
  return{ok:true,mode:'live'};
 },log:(...args)=>logs.push(args)});
 let res=response();await handler({method:'GET'},res);
 assert.equal(res.statusCode,200);assert.equal(res.headers['Cache-Control'],'no-store');
 assert.equal(res.headers['Vercel-CDN-Cache-Control'],'public, s-maxage=5');
 fail=true;res=response();await handler({method:'GET'},res);
 assert.equal(res.statusCode,503);assert.equal(res.body.ok,false);
 assert.equal(res.headers['Vercel-CDN-Cache-Control'],'no-store');
 assert.deepEqual(logs,[['Pilot configuration check failed',{stage:'launch',code:'57014'}]]);
 res=response();await handler({method:'POST'},res);
 assert.equal(res.statusCode,405);assert.equal(loads,2);
});
