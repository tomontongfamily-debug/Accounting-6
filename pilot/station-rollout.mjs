import { createReport, getEffectivePricing, reportKey } from '../src/accounting-engine.js';
import { configuredStations, stationOpeningSlot } from '../src/station-rollout.js';

// Add the new station state once; Liloan's reports, cash, deposits and evidence
// remain in their existing journal. Historical records stay in the archive.
export function prepareStationRollout(state, config, priceBook = {}) {
  if (!config.stationStarts) return state;
  state.branches = configuredStations(config);
  state.stationStarts = {...config.stationStarts};
  state.rolloutVersion = config.rolloutVersion;
  for (const branch of state.branches) {
    if (branch === 'Liloan') continue;
    const start = state.stationStarts[branch];
    state.priceBook[branch] ||= priceBook[branch] || {};
    const opening = stationOpeningSlot(config, branch);
    const key = reportKey(branch, opening.date, opening.shiftId);
    if (state.reports[key]) continue;
    const prices = getEffectivePricing(state.priceBook, branch, start, 'shift-1').prices;
    const report = createReport(branch, opening.date, prices, opening.shiftId);
    Object.assign(report, {pilot:true, baselineReport:true, baselineMissing:true,
      baselineConfirmed:false, baselineReady:false, openingSetupComplete:false,
      openingSetupRequiredAt:opening.date+'T22:00:00+08:00',
      actualCashCounted:0, oilSales:0, pointsIssued:0, pointsWithdrawn:0});
    report.pumpRows = report.pumpRows.map(row => ({...row, opening:'', closing:'', closingEntered:false}));
    report.tankRows = report.tankRows.map(row => ({...row, opening:'', actualDip:''}));
    report.coke = {...report.coke, beginning:'', ending:''};
    state.reports[key] = report;
  }
  return state;
}
