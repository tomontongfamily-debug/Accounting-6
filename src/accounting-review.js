import { midShiftReadingIssues } from './mid-shift-price-change.js';

const labels = {
  CASH_VARIANCE: 'High cash variance',
  PUMP_READING: 'Pump reading needs review',
  REDEMPTION: 'POS redemption or points need review',
  ONLINE_PAY: 'FuelTech Pay needs review',
  MANUAL_DEDUCTION: 'Cash voucher needs review',
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
