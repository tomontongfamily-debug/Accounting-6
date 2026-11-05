import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execute} from '../pilot/repository.mjs';
import {ALL_STATIONS} from '../src/station-rollout.js';
import {stationLoadFixture} from './pilot-station-load-fixture.mjs';

test('station cashier and manager loads survive an offline Liloan POS without changing its evidence',async()=>{
  for(const incremental of [true,false])for(const branch of ALL_STATIONS.filter(b=>b!=='Liloan'))for(const role of ['Cashier','Manager']) {
    const f=stationLoadFixture({incremental}),original=structuredClone(f.state.posRedemptionSync);
    const result=await execute({role,branch},{route:'/api/store/load',input:{paged:true},mode:'live',startDate:f.state.startDate,mutationId:randomUUID()},f);
    assert.equal(result.ok,true);assert.ok(result.reportRows.length>0);
    assert.ok(result.reportRows.every(r=>r.branch===branch));
    const opening=result.reportRows.find(r=>r.data.baselineReport);
    assert.equal(opening.data.confirmed,true);assert.equal(opening.data.pumpRows[0].opening,123450);
    assert.equal(f.stats.fullLoads,0);assert.equal(f.stats.posReads,0);
    for(const patch of f.stats.patches) {
      assert.ok([...patch.upserts,...patch.removals].every(d=>!['pos','pos_rows','pos_points'].includes(d.section)&&!(d.section==='shape'&&['rows','points'].includes(d.key))));
    }
    for(const saved of f.stats.legacyWrites)assert.deepEqual(saved.posRedemptionSync,original);
    assert.deepEqual(f.state.posRedemptionSync,original);
  }
});

test('Liloan, Admin and Approver continue to require their full POS evidence',async()=>{
  for(const session of [{role:'Cashier',branch:'Liloan'},{role:'Manager',branch:'Liloan'},{role:'Admin',branch:''},{role:'Approver',branch:''}]) {
    const f=stationLoadFixture();
    await assert.rejects(execute(session,{route:'/api/store/load',input:{paged:true},mode:'live',startDate:f.state.startDate,mutationId:randomUUID()},f),/Liloan full-history read is unavailable/);
    assert.equal(f.stats.fullLoads,1);
  }
});
