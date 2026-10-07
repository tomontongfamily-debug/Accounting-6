import { compute, getEffectiveDailyPricing, getEffectivePricing } from '../src/accounting-engine.js';
import { midShiftChangeOrder } from '../src/mid-shift-sales-breakdown.js';

export const SELLING_PRODUCTS = ['Premium','Regular','Diesel'];

export function confirmedDailyPricePatch(state, branch, date, products=SELLING_PRODUCTS) {
  const changes=Object.values(state.reports).filter(r=>r.branch===branch&&r.date===date)
    .flatMap(r=>(r.midShiftPriceChanges||[]).filter(c=>c.confirmedAt&&products.includes(c.product))
      .map(c=>({...c,order:midShiftChangeOrder(c,r.shiftId)})))
    .sort((a,b)=>a.order-b.order);
  return Object.fromEntries(changes.map(c=>[c.product,Number(c.newPrice)]));
}

// A confirmation changes only its product, in the same state transaction as the
// photo-backed report. Preserve the latest server values for every other fuel.
export function carryMidShiftPrices(state, report, products) {
  const patch=confirmedDailyPricePatch(state,report.branch,report.date,products);
  const previous=getEffectiveDailyPricing(state.priceBook,report.branch,report.date).prices;
  const prices={...previous,...patch};
  state.priceBook[report.branch][report.date]=prices;
  return {prices,patch};
}

export function syncUnsubmittedPrices(state, branch, date, fromShiftId='shift-1', at=new Date().toISOString()) {
  const changed=[];
  for(const report of Object.values(state.reports)) {
    if(report.branch!==branch||report.confirmed||report.baselineReport||report.date<date
      ||(report.date===date&&report.shiftId<fromShiftId))continue;
    const pricing=getEffectivePricing(state.priceBook,branch,report.date,report.shiftId);
    const prices={...report.prices,...pricing.prices};
    if(JSON.stringify(prices)===JSON.stringify(report.prices))continue;
    const beforeExpected=compute(report).expectedCash;
    report.prices=prices;
    report.pricingCoverage=pricing.pricingCoverage;report.pricingEffectiveDate=pricing.pricingEffectiveDate;report.pricingShiftId=pricing.pricingShiftId;
    report.pilotRevision=Number(report.pilotRevision||0)+1;report.pilotLastNonReadingRevision=report.pilotRevision;
    report.serverMeta={...report.serverMeta,savedAt:at};
    if(beforeExpected!==compute(report).expectedCash){report.cashReviewState='';report.recountRequired=false;}
    changed.push(report);
  }
  return changed;
}
