import { midShiftReadingIssues } from './mid-shift-price-change.js';
import {validateReturnedCalibration} from './fuel-leak-loss.js';

const labels = {
  CASH_VARIANCE: 'High cash variance',
  PUMP_READING: 'Pump reading needs review',
  REDEMPTION: 'POS redemption or points need review',
  ONLINE_PAY: 'FuelTech Pay needs review',
  MANUAL_DEDUCTION: 'Cash voucher needs review',
  BANK_DEPOSIT: 'Deposit allocation needs review',
  BANK_VERIFIER: 'Deposit verification needs review',
  CASH_COUNT: 'Cash count evidence needs review',
};

export function additionalReviewFlags(report) {
  const categories = [...(report.checkCategories || []),
    ...(report.checkDetails || []).map(issue => issue.category),
    ...(report.integrationIssues || []).map(issue => issue.category)].filter(Boolean);
  const flags = categories.map(category => labels[category] || category.replaceAll('_', ' '));
  if (midShiftReadingIssues(report).length) flags.push('Price-change readings need review');
  if (report.checkRequired && !flags.length) flags.push('Report needs review');
  return [...new Set(flags)];
}

const categoryLabels={CASH_VARIANCE:'Cash discrepancy',CASH_COUNT:'Cash count evidence review',PUMP_READING:'Pump reading review',PUMP_OCR_CORRECTION:'Photo reading correction',MANUAL_DEDUCTION:'CV amount / allocation review',ONLINE_PAY:'Online payment review',PO:'Purchase order review',REDEMPTION:'POS points / redemption review',FUEL_PRICE:'Fuel price review',MID_SHIFT_PRICE:'Mid-shift price review',TANK_DELIVERY:'Tank delivery review',BANK_DEPOSIT:'Deposit allocation review',BANK_VERIFIER:'Deposit verification review',CALIBRATION:'Returned calibration review',OTHER:'Report review'};
export const reviewCategoryLabel=category=>categoryLabels[category]||String(category||'OTHER').replaceAll('_',' ');
const actions={
  CASH_VARIANCE:'Compare counted cash with pump sales, payments and approved deductions to identify the difference.',
  CASH_COUNT:'Compare the saved denomination count with the approved cash correction and supporting count sheet.',
  PUMP_READING:'Compare the saved opening and closing readings with the pump photos.',
  PUMP_OCR_CORRECTION:'Check the saved reading against the pump photo.',
  MANUAL_DEDUCTION:'Match the CV reference, approved amount and funding date / shift with the payout receipt.',
  ONLINE_PAY:'Match the imported payment total with the actual FuelTech Pay transactions.',
  PO:'Match the purchase order with its linked transactions.',
  REDEMPTION:'Check the POS points and redemption transaction shown in the issue details.',
  BANK_DEPOSIT:'Compare the receipt with the selected source shifts and assigned amounts.',
  BANK_VERIFIER:'Check the bank reference and the verifier’s rejection reason.',
  CALIBRATION:'Check the peso amount shown by the pump for calibration fuel returned to the tank, and compare it with the saved readings.',
  FUEL_PRICE:'Compare the saved selling price with the approved price for this shift.',
  MID_SHIFT_PRICE:'Check the change time, price and pump readings at the price change.',
  TANK_DELIVERY:'Compare the delivery entry with its delivery receipt.',
};
export function reviewIssuePresentation(issue) {
  const historical=/manager.*reconciliation/i.test(issue.source||'')||/owner-approved manual|historical CV|October manager report|Unmatched reconciliation adjustment/i.test(issue.detail||'');
  return {label:`${historical?'Historical reconciliation · ':''}${reviewCategoryLabel(issue.category)}`,action:actions[issue.category]||'Compare this entry with its supporting record before correcting it.'};
}
export function reviewReasons(report) {
  if(!report?.confirmed)return [];
  const details=[...(report.checkDetails||[]),...(report.integrationIssues||[])];
  const error=validateReturnedCalibration(report);
  if(error)details.push({category:'CALIBRATION',detail:error});
  for(const category of report.checkCategories||[])if(!details.some(issue=>issue.category===category))details.push({category,detail:'This category was flagged, but no detailed reason was saved.'});
  if(report.checkRequired&&!details.length)details.push({category:'OTHER',detail:'This report requires review, but no specific reason was recorded.'});
  const seen=new Set();
  return details.filter(issue=>{const key=JSON.stringify([issue.category,issue.detail]);if(seen.has(key))return false;seen.add(key);return true;});
}
