const keyFor=(config,report)=>'fueltech-pilot-cash-entry-v1:'+JSON.stringify([config.mode,config.start_date,report.branch,report.date,report.shiftId]);

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
export function withCashEntryDraft(report,counts) {
  if(!needsCashEntry(report)||!counts||typeof counts!=='object'||Array.isArray(counts))return report;
  // Quantities stay local until the existing cash-confirm endpoint validates
  // and saves the total. Never change a confirmed count or financial fields.
  return {...report,cashDenominations:{...counts}};
}
export function readCashEntryDraft(storage,config,report) {
  if(!needsCashEntry(report))return null;
  try {const value=JSON.parse(storage.getItem(keyFor(config,report))||'null');return value&&typeof value==='object'&&!Array.isArray(value)?value:null;}
  catch{return null;}
}
export function saveCashEntryDraft(storage,config,report,counts) {
  if(!needsCashEntry(report))return;
  try{storage.setItem(keyFor(config,report),JSON.stringify(counts));}catch{/* The current page retains the entry if device storage is unavailable. */}
}
export function clearCashEntryDraft(storage,config,report) {
  try{storage.removeItem(keyFor(config,report));}catch{/* Confirmed cash is already stored by the server. */}
}
