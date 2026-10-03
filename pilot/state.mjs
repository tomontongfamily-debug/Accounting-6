import { createReport, normalizeReport, carryForwardOpenings, getEffectivePricing, reportKey, compute } from '../src/accounting-engine.js';
import { randomUUID } from 'node:crypto';
import { reportIssues } from './domain.mjs';
import { accountingTiming, dateOffset } from './integrations.mjs';

export function initialState(reportRows, priceRows, config) {
  const state={mode:config.mode,startDate:config.start_date,reports:{},priceBook:{Liloan:{}},photos:{},deposits:[],audit:[],noDepositDays:[0],pay:[],po:[],cvCashEvents:[],sourceAlerts:[]};
  for(const row of priceRows) {
    if(row.branch!=='Liloan') throw Error('Unexpected station in pilot prices');
    state.priceBook.Liloan[row.coverage==='Shift'?`${row.effective_date}__${row.shift_id}`:row.effective_date]=row.prices;
  }
  for(const row of reportRows) {
    if(row.branch!=='Liloan') throw Error('Unexpected station in pilot reports');
    // Preserve original submitted content exactly. Historical data is never written by the pilot.
    state.reports[row.report_key]=structuredClone(row.data);
  }
  state.initializedAt=new Date().toISOString();
  return state;
}

export function ensureCurrentReports(state, now=new Date().toISOString()) {
  const current=accountingTiming(now);
  if(current.date<state.startDate) return;
  // Only build the current day and the preceding day; no invented historical reports.
  for(const date of [dateOffset(current.date,-1),current.date].filter(d=>d>=state.startDate)) {
    for(const shiftId of ['shift-1','shift-2','shift-3']) {
      const key=reportKey('Liloan',date,shiftId);
      if(!state.reports[key]) {
        const prices=getEffectivePricing(state.priceBook,'Liloan',date,shiftId).prices;
        state.reports[key]=carryForwardOpenings(createReport('Liloan',date,prices,shiftId),state.reports);
      } else if(!state.reports[key].confirmed) {
        const r=state.reports[key];
        state.reports[key]=normalizeReport(r,r.branch,r.date,r.shiftId,r.prices);
        // Legacy normalization predates manager photo evidence. Keep server-owned
        // evidence and confirmation metadata through every poll/refresh.
        state.reports[key].midShiftPriceChanges=structuredClone(r.midShiftPriceChanges||[]);
      }
      state.reports[key].pilot=true;
    }
  }
}

const keyOf=r=>reportKey(r.branch,r.date,r.shiftId);
const sameEvent=(a,b)=>!!a&&!!b&&['id','branch','date','shiftId','amount','category','item','fundingSource','account','transactionNumber','fuelType','liters'].every(k=>a[k]===b[k]);
export function reconcileSources(state,incoming) {
  // Owner rule: explicit cancellation/decline removes the deduction, including
  // from a submitted pilot report. Preserve counted cash and an audit trail.
  const alerts=new Map((state.sourceAlerts||[]).map(a=>[a.id,a]));
  const exclusions=new Map((incoming.cvExclusions||[]).map(row=>[row.id,row.status]));
  for(const [id] of exclusions) {alerts.delete(`CV:${id}`);alerts.delete(`cvCashEvents:${id}`);}
  for(const report of Object.values(state.reports)) {
    if(report.date<state.startDate) continue;
    const removed=(report.purchaseRows||[]).filter(row=>row.source==='FuelTech CV'&&exclusions.has(row.sourceVoucherId));
    if(!removed.length) continue;
    const beforeExpectedCash=compute(report).expectedCash;
    report.purchaseRows=report.purchaseRows.filter(row=>!removed.includes(row));
    report.pilotRevision=Number(report.pilotRevision||0)+1;
    report.pilotLastNonReadingRevision=report.pilotRevision;
    report.serverMeta={...report.serverMeta,savedAt:new Date().toISOString()};
    if(report.confirmed) {
      report.checkDetails=reportIssues(report,compute(report).cashVariance);
      report.checkCategories=[...new Set(report.checkDetails.map(i=>i.category))];report.checkRequired=!!report.checkDetails.length;
    } else {report.cashReviewState='';report.recountRequired=false;}
    state.audit.push({id:randomUUID(),at:new Date().toISOString(),action:'cv-excluded-by-source-status',role:'System',branch:'Liloan',reportKey:keyOf(report),removed:removed.map(row=>({sourceVoucherId:row.sourceVoucherId,amount:row.amount,status:exclusions.get(row.sourceVoucherId)})),beforeExpectedCash,afterExpectedCash:compute(report).expectedCash});
  }
  for(const old of state.cvCashEvents) {
    if(exclusions.has(old.id)) continue;
    const next=incoming.cvCashEvents.find(r=>r.id===old.id);
    if(!sameEvent(next,old)) {
      alerts.set(`CV:${old.id}`,{id:`CV:${old.id}`,reportKey:keyOf(old),category:'MANUAL_DEDUCTION',detail:`CV ${old.reference||old.id} changed after import. Review the release before submitting.`,sourceId:old.id});
      incoming.cvCashEvents=incoming.cvCashEvents.filter(r=>r.id!==old.id).concat(old);
    }
  }
  for(const name of ['pay','po','cvCashEvents']) {
    const oldById=new Map(state[name].map(r=>[r.id,r]));
    for(const row of incoming[name]) {
      const report=state.reports[keyOf(row)];
      if(report?.confirmed && report.date>=state.startDate && state.sourcesVerifiedAt && !sameEvent(oldById.get(row.id),row)) {
        alerts.set(`${name}:${row.id}`,{id:`${name}:${row.id}`,reportKey:keyOf(row),category:name==='po'?'PO':name==='pay'?'ONLINE_PAY':'MANUAL_DEDUCTION',detail:'A source transaction changed after submission. The submitted cash snapshot is preserved.',sourceId:row.id});
      }
    }
    for(const old of state[name]) if(!(name==='cvCashEvents'&&exclusions.has(old.id))&&!incoming[name].some(r=>r.id===old.id)&&state.reports[keyOf(old)]?.confirmed) alerts.set(`${name}:${old.id}`,{id:`${name}:${old.id}`,reportKey:keyOf(old),category:name==='po'?'PO':'ONLINE_PAY',detail:'A previously imported transaction is no longer eligible. Review the original report.',sourceId:old.id});
  }
  Object.assign(state,incoming,{sourceAlerts:[...alerts.values()],sourcesVerifiedAt:new Date().toISOString()});
}
