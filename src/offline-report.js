import { isLiloanArchivedSlot } from './opening-health.js';

export function shouldDiscardOfflineReport(report, cleanStartDate) {
  return !report?.branch || !report?.date || !report?.shiftId || report.date < cleanStartDate
    || isLiloanArchivedSlot(report.branch, report.date, report.shiftId);
}

export function isCleanRestartRejection(error) {
  return error?.status === 409 && /before the clean restart/i.test(error.message || "");
}
