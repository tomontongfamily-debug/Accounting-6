const MABOLO_OPENING_DATE = "2026-07-29";
const MABOLO_OPENING_SHIFT_ID = "shift-3";
const SHIFT_IDS = ["shift-1", "shift-2", "shift-3"];
// Liloan's fresh start uses this closing shift as its opening baseline.
const LILOAN_OPENING_DATE = "2026-10-02";

export function isLiloanOpeningSlot(branch, date, shiftId) {
  return branch === "Liloan" && date === LILOAN_OPENING_DATE && shiftId === "shift-3";
}

export function isStationPreOpeningSlot(branch, date, shiftId) {
  return isMaboloPreOpeningSlot(branch, date, shiftId)
    || (branch === "Liloan" && date === LILOAN_OPENING_DATE && ["shift-1", "shift-2"].includes(shiftId));
}

export function openingSlotHealth(report, branch, date, shiftId) {
  if (!isLiloanOpeningSlot(branch, date, shiftId)) return null;
  const complete = report?.confirmed || report?.baselineConfirmed || report?.openingSetupComplete;
  return { label: complete ? "Submitted" : "Missing", tone: complete ? "green" : "red", detail: complete ? "Beginning Setup" : "Beginning Setup Missing" };
}

export function isMaboloPreOpeningSlot(branch, date, shiftId) {
  if (branch !== "Mabolo" || date !== MABOLO_OPENING_DATE) return false;
  return SHIFT_IDS.indexOf(shiftId) < SHIFT_IDS.indexOf(MABOLO_OPENING_SHIFT_ID);
}
