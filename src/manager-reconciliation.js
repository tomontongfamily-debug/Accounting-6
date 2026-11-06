const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export function approvedManagerReconciliation(report) {
  const r = report?.managerReconciliation;
  return report?.branch === 'Liloan' && report.date >= '2026-10-03' && report.date <= '2026-10-31'
    && r?.version === 1 && r.approvedBy && Number.isFinite(Date.parse(r.approvedAt))
    && /^[a-f0-9]{64}$/.test(r.sourceSha256 || '')
    && ['grossFuelSales','calibrationCash','cashVoucherTotal','otherCashOutlays','cashCount'].every(k => Number.isFinite(r[k]) && r[k] >= 0)
    ? r : null;
}
export function managerReconciliationAdjustments(report, sourcePurchaseTotal, baseFuelSales) {
  const r = approvedManagerReconciliation(report);
  if (!r) return { sales: 0, cashVouchers: 0, otherCash: 0 };
  return { sales: r.grossFuelSales - r.calibrationCash - baseFuelSales,
    cashVouchers: r.cashVoucherTotal - sourcePurchaseTotal, otherCash: r.otherCashOutlays };
}
export function managerReconciliationIssues(report) {
  const r = approvedManagerReconciliation(report);
  if (!r) return [];
  const imported = (report.purchaseRows || []).reduce((s,p) => s + Number(p.amount || 0), 0);
  const difference = round(r.cashVoucherTotal - imported);
  const issues = [];
  if (Math.abs(difference) >= .01) issues.push({ source:'Manager reconciliation',category:'MANUAL_DEDUCTION',detail:`October manager report records ${r.cashVoucherTotal.toFixed(2)} in cash vouchers; linked records total ${imported.toFixed(2)}. Unmatched reconciliation adjustment: ${difference.toFixed(2)}. Match payout receipts and source CVs.` });
  if (r.photoConflicts?.length) issues.push({ source:'Manager reconciliation',category:'PUMP_READING',detail:`Owner-approved manual readings differ from retained pump-photo records for ${r.photoConflicts.length} nozzle(s). Original readings and photos are preserved for review.` });
  if (r.cvMatchingNotes?.length) issues.push({ source:'Manager reconciliation',category:'MANUAL_DEDUCTION',detail:`Historical CV matching still needs receipt verification: ${r.cvMatchingNotes.map(n => n.reference + ': ' + n.note).join('; ')}` });
  if (Number.isFinite(r.manualOnlinePay) && Math.abs(round(r.manualOnlinePay - Number(report.deductions?.gcash || 0))) >= .01) issues.push({ source:'Manager reconciliation',category:'ONLINE_PAY',detail:`Manager online payments: ${r.manualOnlinePay.toFixed(2)}; actual FuelTech Pay: ${Number(report.deductions?.gcash || 0).toFixed(2)}. Actual payment records are retained.` });
  return issues;
}
export function managerDepositCoverageIssues(report, state) {
  if (!state) return [];
  const key=report.branch+'__'+report.date+'__'+report.shiftId;
  return (state.deposits || []).filter(d => d.status !== 'rejected' && d.allocationVersion !== 1 && d.anchorKey === key && (d.coveredReportKeys || []).some(k => approvedManagerReconciliation(state.reports[k]))).flatMap(d => {
    const reports=(d.coveredReportKeys || []).map(k => state.reports[k]);
    if (reports.some(r => !r || !Number.isFinite(Number(r.actualCashCounted)))) return [];
    const cash=round(reports.reduce((sum,r) => sum+Number(r.actualCashCounted),0)), saved=Number(d.coveredCash), difference=round(cash-saved);
    return Number.isFinite(saved) && Math.abs(difference)>=.01 ? [{source:'Manager cash/deposit reconciliation',category:'BANK_DEPOSIT',detail:`Deposit ${d.reference}: corrected cash in covered shifts is ${cash.toFixed(2)}; saved coverage is ${saved.toFixed(2)} (difference ${difference.toFixed(2)}). Original deposit amount and record are retained. Verify the cash coverage and bank receipt.`}] : [];
  });
}
export function refreshManagerReconciliation(report, state) {
  if (!approvedManagerReconciliation(report) && !state) return report;
  return { ...report, integrationIssues:[...(report.integrationIssues || []).filter(i => !['Manager reconciliation','Manager cash/deposit reconciliation'].includes(i.source)), ...managerReconciliationIssues(report), ...managerDepositCoverageIssues(report,state)] };
}
