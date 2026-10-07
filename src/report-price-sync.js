export function applyEffectivePricing(report, pricing) {
  if (report?.branch === 'Liloan' && report.confirmed) return report;
  if (!report || !pricing?.pricingEffectiveDate) return report;
  return {
    ...report,
    prices: { ...(report.prices || {}), ...(pricing.prices || {}) },
    pricingCoverage: pricing.pricingCoverage,
    pricingEffectiveDate: pricing.pricingEffectiveDate,
    pricingShiftId: pricing.pricingShiftId,
  };
}
