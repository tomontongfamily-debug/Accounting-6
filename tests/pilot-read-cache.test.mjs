import test from 'node:test';
import assert from 'node:assert/strict';
import {loadState} from '../pilot/storage.mjs';

function fixture(){
 const control={revision:4,calls:0,heads:0,fail:false,headFail:false};
 const db={from(table){assert.equal(table,'fueltech_pilot_heads');return {select(){return this;},eq(){return this;},async maybeSingle(){control.heads++;return control.headFail?{error:{message:'unavailable'}}:{data:{revision:control.revision}};}};},async rpc(name,options){control.calls++;await new Promise(resolve=>setTimeout(resolve,8));if(control.fail)return {error:{message:'unavailable'}};return {data:{revision:control.revision,data:{mode:options.p_mode,reports:{saved:{notes:'saved'}},audit:options.p_audit_limit?[options.p_before]:[],fullPos:name==='fueltech_pilot_load_v2'}}};}};
 return {db,control};
}

test('simultaneous manager loads share one reconstruction and each receive an isolated snapshot',async()=>{
 const {db,control}=fixture();
 const rows=await Promise.all(Array.from({length:12},()=>loadState(db,'live',{cache:true})));
 assert.equal(control.calls,1);assert.equal(control.heads,12);
 rows[0].data.reports.saved.notes='unsaved local edit';
 assert.equal(rows[1].data.reports.saved.notes,'saved');
 assert.equal((await loadState(db,'live',{cache:true})).data.reports.saved.notes,'saved');
 assert.equal(control.calls,1);
 control.revision++;
 assert.equal((await loadState(db,'live',{cache:true})).revision,5);assert.equal(control.calls,2);
});

test('mode, audit cursor and full evidence do not share the wrong snapshot, and failed reads can retry',async()=>{
 const {db,control}=fixture();
 const compact=await loadState(db,'live',{cache:true});assert.equal(compact.data.fullPos,false);
 const full=await loadState(db,'live',{cache:true,fullPos:true});assert.equal(full.data.fullPos,true);
 const audit=await loadState(db,'live',{cache:true,audit:true,before:12});assert.deepEqual(audit.data.audit,[12]);
 assert.equal((await loadState(db,'shadow',{cache:true})).data.mode,'shadow');assert.equal(control.calls,4);
 control.revision++;control.fail=true;await assert.rejects(loadState(db,'live',{cache:true}),/Unable to load/);
 control.fail=false;assert.equal((await loadState(db,'live',{cache:true})).revision,5);assert.equal(control.calls,6);
 control.headFail=true;await assert.rejects(loadState(db,'live',{cache:true}),/current station revision/);
});
