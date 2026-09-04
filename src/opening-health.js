const MABOLO_OPENING_DATE = "2026-07-29";
const MABOLO_OPENING_SHIFT_ID = "shift-3";
const SHIFT_IDS = ["shift-1", "shift-2", "shift-3"];

export function isMaboloPreOpeningSlot(branch, date, shiftId) {
  if (branch !== "Mabolo" || date !== MABOLO_OPENING_DATE) return false;
  return SHIFT_IDS.indexOf(shiftId) < SHIFT_IDS.indexOf(MABOLO_OPENING_SHIFT_ID);
}
