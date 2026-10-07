import { automaticCashVouchers } from './domain.mjs';
import { dateOffset } from './integrations.mjs';
import { reportKey } from '../src/accounting-engine.js';

// Server-owned Accounting allocations do not alter CV source events or amounts.
function allocatedEvent(state, event) {
  const override = state.cvAllocationOverrides?.[event.sourceVoucherId || event.id];
  if (!override) return event;
  const date = dateOffset(override.toDate, 0), shiftId = override.toShiftId;
  const target = state.reports[reportKey(event.branch, date, shiftId)];
  if (event.branch !== 'Liloan' || date < state.startDate || !target || target.baselineReport
      || !['shift-1', 'shift-2', 'shift-3'].includes(shiftId)
      || !override.id || !override.reason || !override.approvedBy
      || !Number.isFinite(Date.parse(override.approvedAt))) throw Error('Invalid approved Accounting CV allocation.');
  return { ...event, date, shiftId, accountingAllocation: override };
}

export function cvAllocationReportKey(state, event) {
  const allocated = allocatedEvent(state, event);
  return reportKey(allocated.branch, allocated.date, allocated.shiftId);
}

export function accountingCashVouchers(state, report) {
  const events = (state.cvCashEvents || []).map(event => allocatedEvent(state, event));
  const overrides = new Map(events.filter(e => e.accountingAllocation).map(e => [e.sourceVoucherId, e.accountingAllocation]));
  return automaticCashVouchers(events, report).map(row => overrides.has(row.sourceVoucherId)
    ? { ...row, accountingAllocation: overrides.get(row.sourceVoucherId) } : row);
}
