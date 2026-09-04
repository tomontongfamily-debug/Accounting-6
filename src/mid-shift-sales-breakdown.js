import { midShiftBasePrice, midShiftReadingValue } from "./mid-shift-price-change.js";

const SHIFT_BOUNDS = {
  "shift-1": ["04:00", "13:00"],
  "shift-2": ["13:00", "22:00"],
  "shift-3": ["22:00", "04:00"],
};

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clockMinutes(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : -1;
}

export function midShiftChangeOrder(change, shiftId) {
  const minutes = clockMinutes(change?.effectiveTime);
  return shiftId === "shift-3" && minutes >= 0 && minutes < 240 ? minutes + 1440 : minutes;
}

function clockLabel(value) {
  const minutes = clockMinutes(value);
  if (minutes < 0) return "Time not set";
  const hours = Math.floor(minutes / 60);
  const minuteText = String(minutes % 60).padStart(2, "0");
  return `${hours % 12 || 12}:${minuteText} ${hours < 12 ? "AM" : "PM"}`;
}

export function midShiftReadingRows(report) {
  return (report?.midShiftPriceChanges || []).flatMap((change, changeIndex) => (
    (report?.pumpRows || [])
      .filter((pumpRow) => pumpRow.product === change.product)
      .map((pumpRow, pumpIndex) => {
        const savedReading = midShiftReadingValue(change, pumpRow);
        return {
          id: `${change.id || changeIndex}-${pumpRow.id || pumpIndex}`,
          pump: pumpRow.pump,
          nozzle: pumpRow.nozzle,
          product: pumpRow.product,
          effectiveTime: clockLabel(change.effectiveTime),
          newPrice: Math.max(0, number(change.newPrice)),
          reading: savedReading === "" || savedReading == null ? null : number(savedReading),
          confirmed: Boolean(change.confirmedAt),
        };
      })
  ));
}

export function midShiftSalesBreakdown(report) {
  const [shiftStart, shiftEnd] = SHIFT_BOUNDS[report?.shiftId] || SHIFT_BOUNDS["shift-1"];
  return (report?.pumpRows || []).flatMap((pumpRow) => {
    const changes = (report.midShiftPriceChanges || [])
      .filter((change) => change.product === pumpRow.product)
      .sort((a, b) => midShiftChangeOrder(a, report.shiftId) - midShiftChangeOrder(b, report.shiftId));
    if (!changes.length) return [];

    const opening = number(pumpRow.opening);
    const closing = number(pumpRow.closing);
    let readingFrom = opening;
    let fromTime = shiftStart;
    let price = Math.max(0, number(midShiftBasePrice(report, pumpRow.product)));
    const rows = [];

    changes.forEach((change, index) => {
      const readingTo = number(midShiftReadingValue(change, pumpRow));
      if (number(change.newPrice) <= 0 || readingTo < opening || readingTo > closing || readingTo < readingFrom) return;
      const liters = readingTo - readingFrom;
      if (liters > 0) {
        rows.push({
          id: `${pumpRow.id || `${pumpRow.pump}-${pumpRow.nozzle}`}-${change.id || index}-before`,
          pump: pumpRow.pump,
          nozzle: pumpRow.nozzle,
          product: pumpRow.product,
          fromLabel: clockLabel(fromTime),
          toLabel: clockLabel(change.effectiveTime),
          readingFrom,
          readingTo,
          liters,
          price,
          sales: liters * price,
        });
      }
      readingFrom = readingTo;
      fromTime = change.effectiveTime;
      price = Math.max(0, number(change.newPrice));
    });

    const liters = closing - readingFrom;
    if (liters > 0) {
      rows.push({
        id: `${pumpRow.id || `${pumpRow.pump}-${pumpRow.nozzle}`}-after`,
        pump: pumpRow.pump,
        nozzle: pumpRow.nozzle,
        product: pumpRow.product,
        fromLabel: clockLabel(fromTime),
        toLabel: clockLabel(shiftEnd),
        readingFrom,
        readingTo: closing,
        liters,
        price,
        sales: liters * price,
      });
    }
    return rows;
  });
}
