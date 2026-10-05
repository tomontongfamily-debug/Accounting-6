import assert from 'node:assert/strict';
import { fixture } from './pilot-fixture.mjs';

export function correctionFixture(depositStatus='pending') {
  const f=fixture(),r=f.state.reports[f.key];
  r.confirmed=true;r.confirmedAt='2026-09-23T05:01:00Z';r.pilotRevision=7;
  r.pilotCashRevision=2;r.cashCountConfirmed=true;r.actualCashCounted=500;r.cashDenominations={100:5};
  r.correctionRequest={id:'correction-test',status:'pending',reason:'Incorrect pump photo',branch:r.branch,reportDate:r.date,shiftId:r.shiftId,requestedAt:'2026-09-23T05:02:00Z'};
  for(const row of r.pumpRows) {
    const photo='/api/pilot/photo?id=fixture-'+row.id;
    f.state.photos[photo]={branch:r.branch,reportKey:f.key,rowId:row.id};
    Object.assign(row,{closing:Number(row.opening)+10,closingEntered:true,readingConfirmed:true,photo_path:photo,readingRevision:3});
  }
  f.state.deposits=[{id:'deposit-test',status:depositStatus,anchorKey:f.key,coveredReportKeys:[f.key],carryoverSourceIds:[],carryoverRemaining:0,previousCarryover:0,unexplainedDifference:0,amount:500,coveredCash:500,expected:500,adjustments:[],reference:'TEST-ONLY',bank:'Test bank',manager:'Test manager',depositDate:'2026-09-24',coverageLabel:'1 report',branch:'Liloan',verified:depositStatus==='verified'}];
  f.report=structuredClone(r);
  return f;
}

export function correctionDatabase(initial) {
  let data=structuredClone(initial),revision=10;
  const mirrored={};
  return {
    get data(){return data;},get mirrored(){return mirrored;},
    from(table){
      const result={data:table==='fueltech_pilot_config'?{mode:data.mode,start_date:data.startDate}:table==='fueltech_pilot_state'?{revision,data:structuredClone(data)}:null,error:null};
      const query=new Proxy({}, {get:(_target,key)=>key==='then'?(resolve=>resolve(result)):()=>query});return query;
    },
    async rpc(_name,params){
      assert.equal(params.p_revision,revision);
      data=structuredClone(params.p_data);revision++;
      for(const [key,report] of Object.entries(data.reports))mirrored[key]=structuredClone(report);
      return {data:params.p_result,error:null};
    },
  };
}

