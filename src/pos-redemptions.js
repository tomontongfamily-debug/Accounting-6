const cents=value=>Math.round(Number(value||0)*100);
export function posRedemptionComparison(report) {
  const evidence=report?.posRedemptions;
  if(!evidence||report.branch!=='Liloan')return null;
  const entered=cents(report.deductions?.posRedemption)+cents(report.deductions?.cashRedemption)+cents(report.deductions?.fuelRedemption);
  const fresh=evidence.status==='verified'&&Number.isFinite(Date.parse(evidence.verifiedAt))&&Date.now()-Date.parse(evidence.verifiedAt)<120000;
  return {evidence,entered:entered/100,difference:(entered-cents(evidence.cashTotal))/100,fresh};
}
export function posRedemptionIssues(report) {
  const comparison=posRedemptionComparison(report);
  if(!comparison)return [];
  const {evidence,entered,difference}=comparison;
  if(evidence.status!=='verified')return [{source:'FuelTech POS',category:'REDEMPTION',detail:'POS redemptions could not be verified. The last successful copy is retained; it is not a zero-redemption result.'}];
  const issues=[];
  if(difference!==0)issues.push({source:'FuelTech POS',category:'REDEMPTION',detail:`POS monetary redemptions ${Number(evidence.cashTotal).toFixed(2)}; Accounting deduction ${entered.toFixed(2)}; difference ${difference.toFixed(2)}.`});
  if(evidence.automatic&&evidence.pointsStatus!=='verified')issues.push({source:'FuelTech POS',category:'REDEMPTION',detail:evidence.pointIssues?.length?`Points issued need POS review: ${evidence.pointIssues.map(r=>`${r.id}: ${r.issue}`).join('; ')}. Existing points are retained; redemptions remain automatic.`:'POS points could not be verified; the previous points value is retained.'});
  return issues;
}
