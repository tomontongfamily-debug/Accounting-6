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
