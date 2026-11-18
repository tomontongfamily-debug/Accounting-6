export function shiftIdForEffectiveTime(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return "";

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "";

  const minuteOfDay = hours * 60 + minutes;
  if (minuteOfDay >= 4 * 60 && minuteOfDay < 13 * 60) return "shift-1";
  if (minuteOfDay >= 13 * 60 && minuteOfDay < 22 * 60) return "shift-2";
  return "shift-3";
}

const shiftHours = {
  "shift-1": "Shift 1 (4 AM to 1 PM)",
  "shift-2": "Shift 2 (1 PM to 10 PM)",
  "shift-3": "Shift 3 (10 PM to 4 AM)",
};

export function midShiftTimeError(time, shiftId) {
  const actualShift = shiftIdForEffectiveTime(time);
  if (!actualShift) return "Enter the effective time, including AM or PM.";
  if (actualShift === shiftId) return "";
  return `${time} belongs to ${shiftHours[actualShift]}. Check AM or PM, or select that report. You are editing ${shiftHours[shiftId] || shiftId}.`;
}

export function clockMinutes(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : -1;
}

export function midShiftChangeOrder(change, shiftId) {
  const minutes = clockMinutes(change?.effectiveTime);
  return shiftId === "shift-3" && minutes >= 0 && minutes < 240 ? minutes + 1440 : minutes;
}
