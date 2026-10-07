import { createReport, normalizeReport, carryForwardOpenings, getEffectivePricing, reportKey, compute } from '../src/accounting-engine.js';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { automaticTransactions, reportIssues } from './domain.mjs';
import { accountingCashVouchers, cvAllocationReportKey } from './cv-allocations.mjs';
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
  const exclusions=new Map([...(incoming.cvExclusions||[]),...(incoming.cvOutOfScope||[])].map(row=>[row.id,row.status]));
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
    // The explicit creation-time policy may move an unchanged voucher once.
    // Unexplained amount/category changes or disappearance still need review.
    const creationMigration=next?.assignmentBasis==='created_at'&&old.assignmentBasis!=='created_at'
      && ['id','branch','amount','category','item','fundingSource'].every(k=>next[k]===old[k]);
    if(!sameEvent(next,old)&&!creationMigration) {
      alerts.set(`CV:${old.id}`,{id:`CV:${old.id}`,reportKey:cvAllocationReportKey(state,old),category:'MANUAL_DEDUCTION',detail:`CV ${old.reference||old.id} changed after import. Review the release before submitting.`,sourceId:old.id});
      incoming.cvCashEvents=incoming.cvCashEvents.filter(r=>r.id!==old.id).concat(old);
    } else alerts.delete(`CV:${old.id}`);
  }
  for(const name of ['pay','po','cvCashEvents']) {
    const oldById=new Map(state[name].map(r=>[r.id,r]));
    for(const row of incoming[name]) {
      const old=oldById.get(row.id);
      alerts.delete(`${name}:${row.id}`);
      if(name!=='cvCashEvents'&&old&&!sameEvent(old,row)&&state.reports[keyOf(old)]?.confirmed) {
        alerts.set(`${name}:${row.id}`,{id:`${name}:${row.id}`,reportKey:keyOf(old),category:name==='po'?'PO':'ONLINE_PAY',detail:'An existing source transaction changed after submission. Review the original report.',sourceId:row.id});
        incoming[name]=incoming[name].filter(r=>r.id!==row.id).concat(old);
      }
    }
    for(const old of state[name]) if(!(name==='cvCashEvents'&&exclusions.has(old.id))&&!incoming[name].some(r=>r.id===old.id)&&state.reports[keyOf(old)]?.confirmed) {
      alerts.set(`${name}:${old.id}`,{id:`${name}:${old.id}`,reportKey:keyOf(old),category:name==='po'?'PO':'ONLINE_PAY',detail:'A previously imported transaction is no longer eligible. Review the original report.',sourceId:old.id});
      incoming[name]=incoming[name].concat(old);
    }
  }
  Object.assign(state,incoming,{sourceAlerts:[...alerts.values()],sourcesVerifiedAt:new Date().toISOString()});
  for(const report of Object.values(state.reports)) {
    if(!report.confirmed||report.baselineReport||report.date<state.startDate)continue;
    const pay=automaticTransactions(state.pay,report),po=automaticTransactions(state.po,report);
    const before={purchaseRows:report.purchaseRows||[],poRows:report.poRows||[],onlinePay:report.onlinePay,deductions:report.deductions};
    const after=JSON.parse(JSON.stringify({
      purchaseRows:[...before.purchaseRows.filter(row=>row.source!=='FuelTech CV'),...accountingCashVouchers(state,report)],
      poRows:po.transactions.map(row=>({...row,source:'FuelTech Pay'})),
      onlinePay:{total:pay.total,count:pay.count,source:'FuelTech Pay'},
      deductions:{...report.deductions,gcash:pay.total,card:0,paymaya:0},
    }));
    if(isDeepStrictEqual(before,after))continue;
    const beforeExpectedCash=compute(report).expectedCash;
    Object.assign(report,after);
    report.pilotRevision=Number(report.pilotRevision||0)+1;
    report.pilotLastNonReadingRevision=report.pilotRevision;
    report.serverMeta={...report.serverMeta,savedAt:new Date().toISOString()};
    report.checkDetails=reportIssues(report,compute(report).cashVariance);
    report.checkCategories=[...new Set(report.checkDetails.map(i=>i.category))];report.checkRequired=!!report.checkDetails.length;
    state.audit.push({id:randomUUID(),at:new Date().toISOString(),action:'source-shift-reconciled',role:'System',branch:'Liloan',reportKey:keyOf(report),before,after,beforeExpectedCash,afterExpectedCash:compute(report).expectedCash,assignment:'CV creation time; Pay paid time; PO transaction time'});
  }
  // Persist review evidence with the canonical report as well as pilot state.
  // Admin's general report endpoint cannot see state-only source alerts.
  for(const report of Object.values(state.reports)) {
    if(report.date<state.startDate||report.baselineReport)continue;
    const issues=[...(report.integrationIssues||[]).filter(i=>i.source!=='Source reconciliation'),
      ...state.sourceAlerts.filter(a=>a.reportKey===keyOf(report)).map(a=>({...a,source:'Source reconciliation'}))];
    if(isDeepStrictEqual(report.integrationIssues||[],issues))continue;
    report.integrationIssues=issues;
    if(report.confirmed) {
      report.checkDetails=reportIssues(report,compute(report).cashVariance);
      report.checkCategories=[...new Set(report.checkDetails.map(i=>i.category))];report.checkRequired=!!report.checkDetails.length;
    }
    report.pilotRevision=Number(report.pilotRevision||0)+1;
    report.pilotLastNonReadingRevision=report.pilotRevision;
    report.serverMeta={...report.serverMeta,savedAt:new Date().toISOString()};
    state.audit.push({id:randomUUID(),at:new Date().toISOString(),action:'source-review-status-changed',role:'System',branch:'Liloan',reportKey:keyOf(report),issues});
  }
}
