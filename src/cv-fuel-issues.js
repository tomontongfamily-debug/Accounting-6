export function cvFuelIssueSummary(report) {
  const liters = {Premium:0,Regular:0,Diesel:0}, sales = {...liters};
  const seen = new Set();
  for (const row of report.cvFuelRows || []) {
    if (!row.sourceVoucherId || seen.has(row.sourceVoucherId) || !Object.hasOwn(liters,row.product) || !Number.isFinite(Number(row.liters)) || Number(row.liters)<=0 || !Number.isFinite(Number(row.amount)) || Number(row.amount)<=0) throw Error('Invalid or duplicate station Fuel CV.');
    seen.add(row.sourceVoucherId);liters[row.product]+=Number(row.liters);sales[row.product]+=Number(row.amount);
  }
  return {liters,sales,totalLiters:Object.values(liters).reduce((a,b)=>a+b,0),totalSales:Object.values(sales).reduce((a,b)=>a+b,0)};
}

export function refreshFuelCVReview(report, result) {
  const issues = (result.cvFuelExcessProducts || []).map(product => ({ source:'Fuel CV allocation', category:'MANUAL_DEDUCTION', detail:`${product} Fuel CVs exceed the metered liters or sales available in this shift. Review the funding shift, liters and amount.` }));
  const next = { ...report, integrationIssues:[...(report.integrationIssues || []).filter(i => i.source !== 'Fuel CV allocation'), ...issues] };
  if (report.confirmed) {
    next.checkDetails=[...(report.checkDetails || []).filter(i => i.source !== 'Fuel CV allocation'), ...issues];
    next.checkCategories=[...new Set(next.checkDetails.map(i => i.category))];
    next.checkRequired=!!next.checkDetails.length;
  }
  return next;
}
