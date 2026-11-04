import { createReport, reportKey } from '../src/accounting-engine.js';
import { initialState } from '../pilot/state.mjs';
import { runAction } from '../pilot/service.mjs';
export function fixture() {
  const prices={Premium:70,Regular:65,Diesel:60};
  const previous=createReport('Liloan','2026-09-22',prices,'shift-3');
  previous.confirmed=true;previous.baselineConfirmed=true;
  previous.pumpRows=previous.pumpRows.map((r,i)=>({...r,opening:10000+i*1000,closing:10000+i*1000,closingEntered:true}));
  const report=createReport('Liloan','2026-09-23',prices,'shift-1');
  report.baselineConfirmed=true;report.cashierName='Test cashier';
  report.pumpRows=report.pumpRows.map((r,i)=>({...r,opening:10000+i*1000}));
  const state=initialState([previous,report].map(data=>({branch:'Liloan',report_key:reportKey(data.branch,data.date,data.shiftId),data})),[{branch:'Liloan',effective_date:'2026-09-22',coverage:'Daily',prices}],{mode:'shadow',start_date:'2026-09-23'});
  state.sourcesVerifiedAt=new Date().toISOString();
  return {state,report,key:reportKey(report.branch,report.date,report.shiftId),cashier:{role:'Cashier',branch:'Liloan'},manager:{role:'Manager',branch:'Liloan'},admin:{role:'Admin',branch:''},approver:{role:'Approver',branch:''}};
}

export async function openingPhoto(state,key,rowId,value) {
  const session={role:'Cashier',branch:state.reports[key].branch};
  const base=state.reports[key].pumpRows.find(row=>row.id===rowId);
  let out=await runAction(state,session,'/api/demo/photo',{reportKey:key,rowId,revision:base.readingRevision||0,replaceReading:true,data:'data:image/jpeg;base64,/9j/2Q=='},{uploadPhoto:async()=>{}});
  state=out.state;
  const row=state.reports[key].pumpRows.find(row=>row.id===rowId);
  out=await runAction(state,session,'/api/demo/pump-reading',{reportKey:key,revision:row.readingRevision,row:{...row,closing:value,readingConfirmed:true,closingEntered:true,ocr_detected_reading:value,ocr_result:{status:'detected',version:'fixture'}}});
  return out.state;
}

export async function openingPhotos(state,report) {
  const key=reportKey(report.branch,report.date,report.shiftId);
  for(const row of report.pumpRows)state=await openingPhoto(state,key,row.id,Number(row.opening));
  report.pilotRevision=state.reports[key].pilotRevision;
  return state;
}
