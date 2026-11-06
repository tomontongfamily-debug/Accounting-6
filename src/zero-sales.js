export function requiresZeroSalesConfirmation(report,result) {
  return !report.baselineReport&&Number.isFinite(result.grossSales)&&Math.abs(result.grossSales)<.005;
}
export function zeroSalesReviewKey(report,result) {
  return JSON.stringify([report.branch,report.date,report.shiftId,Math.round(result.grossSales*100),Math.round(result.totalLiters*1000),(report.pumpRows||[]).map(r=>[r.id,Number(r.opening),Number(r.closing)])]);
}
