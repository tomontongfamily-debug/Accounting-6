import assert from 'node:assert/strict';
import {fixture} from './pilot-fixture.mjs';
import {prepareStationRollout} from '../pilot/station-rollout.mjs';
import {ensureCurrentReports} from '../pilot/state.mjs';
import {withStationRollout} from '../src/station-rollout.js';

// A healthy station store with an offline, stale Liloan-only POS connection.
// A station load should still return the saved opening and current drafts.
export function stationLoadFixture({incremental=true}={}) {
  const {state}=fixture();state.mode='live';state.startDate='2026-10-03';
  const config=withStationRollout({mode:'live',start_date:state.startDate,...(incremental?{storage_version:2}:{})});
  prepareStationRollout(state,config);
  for(const report of Object.values(state.reports).filter(r=>r.baselineReport&&r.branch!=='Liloan')) {
    Object.assign(report,{confirmed:true,baselineConfirmed:true,baselineMissing:false,baselineReady:true,openingSetupComplete:true,cashierName:'Saved test cashier'});
    report.pumpRows=report.pumpRows.map(r=>({...r,opening:123450,closing:123450,closingEntered:true}));
    report.tankRows=report.tankRows.map(r=>({...r,opening:1000,actualDip:1000}));
    report.coke={...report.coke,beginning:0,ending:0};
  }
  ensureCurrentReports(state);ensureCurrentReports(state);
  state.posRedemptionSync={status:'verified',startDate:state.startDate,attemptedAt:'2026-10-03T00:00:00Z',verifiedAt:'2026-10-03T00:00:00Z',rows:[{id:'kept-withdrawal',date:'2026-10-03',shiftId:'shift-1',type:'Cash',amount:77,quantity:0}],points:[{id:'kept-point',date:'2026-10-03',shiftId:'shift-1',points:11,voided:false}]};
  const stats={fullLoads:0,posReads:0,patches:[],legacyWrites:[]};
  const snapshot=()=>{
    const data=structuredClone(state);
    if(incremental){delete data.posRedemptionSync.rows;delete data.posRedemptionSync.points;data.posRedemptionSync._deferred=true;}
    return {revision:10,data};
  };
  const db={from(table){
    const result={data:table==='fueltech_pilot_config'?config:table==='fueltech_pilot_state'?snapshot():null,error:null};
    return new Proxy({}, {get:(_target,key)=>key==='then'?(resolve=>resolve(result)):()=>db.from(table)});
  },async rpc(name,params){
    if(name==='fueltech_pilot_load_compact')return {data:snapshot()};
    if(name==='fueltech_pilot_load_v2'){stats.fullLoads++;throw Error('Unrelated Liloan full-history read is unavailable');}
    assert.ok(['fueltech_pilot_commit_v2','fueltech_pilot_commit'].includes(name),name);
    if(params.p_patch)stats.patches.push(params.p_patch);
    if(params.p_data)stats.legacyWrites.push(params.p_data);
    return {data:params.p_result};
  }};
  const posRead=async()=>{stats.posReads++;throw Error('Unrelated POS connection is offline');};
  return {state,config,db,posRead,stats,posEnv:{FUELTECH_POS_REDEMPTIONS_ENABLED:'true'}};
}
