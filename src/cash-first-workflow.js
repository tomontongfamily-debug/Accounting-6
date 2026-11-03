export function needsCashEntry(report) {
  return Boolean(report&&!report.confirmed&&!report.cashCountConfirmed&&!report.baselineMissing&&!report.baselineReport);
}

export function initialCashierStep(report,savedStep,maximumStep=4) {
  if(report.baselineMissing||report.baselineReport)return 1;
  if(report.confirmed)return maximumStep;
  if(needsCashEntry(report))return 0;
  const saved=Number(savedStep);
  if(saved===5&&maximumStep===4)return 4;
  return Number.isInteger(saved)&&saved>=0&&saved<=maximumStep?saved:0;
}
