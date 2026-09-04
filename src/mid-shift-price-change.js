export function midShiftPumpKey(row) {
  return `${row.pump}|${row.nozzle}|${row.product}`;
}

export function midShiftReadingValue(change, row) {
  const readings = change.readings || {};
  return readings[midShiftPumpKey(row)] ?? readings[row.id] ?? "";
}

function sellingPrices(prices = {}) {
  return {
    Premium: prices.Premium ?? 0,
    Regular: prices.Regular ?? 0,
    Diesel: prices.Diesel ?? 0,
  };
}

export function ensureMidShiftBasePrices(report) {
  if (report.midShiftBasePrices) return report;
  return { ...report, midShiftBasePrices: sellingPrices(report.prices) };
}

export function midShiftBasePrice(report, product) {
  return report.midShiftBasePrices?.[product] ?? report.prices?.[product] ?? 0;
}

export function reportStartingPrice(report, product) {
  const hasMidShiftChange = (report.midShiftPriceChanges || []).some((change) => change.product === product);
  return hasMidShiftChange ? midShiftBasePrice(report, product) : report.prices?.[product] ?? 0;
}

export function pricesAfterMidShift(basePrices = {}, changes = []) {
  const prices = { ...basePrices };
  changes
    .map((change, index) => ({ change, index }))
    .sort((a, b) => {
      const timeOrder = String(a.change.effectiveTime || "").localeCompare(String(b.change.effectiveTime || ""));
      return timeOrder || a.index - b.index;
    })
    .forEach(({ change }) => {
      const price = Number(change.newPrice);
      if (["Premium", "Regular", "Diesel"].includes(change.product) && Number.isFinite(price) && price > 0) {
        prices[change.product] = price;
      }
    });
  return prices;
}

export function addMidShiftChange(report, id) {
  const reportWithBasePrices = ensureMidShiftBasePrices(report);
  return {
    ...reportWithBasePrices,
    midShiftPriceChanges: [
      ...(reportWithBasePrices.midShiftPriceChanges || []),
      { id, product: "Premium", effectiveTime: "", newPrice: "", readings: {} },
    ],
  };
}

export function patchMidShiftChange(report, id, key, value) {
  return {
    ...report,
    midShiftPriceChanges: (report.midShiftPriceChanges || []).map((change) =>
      change.id === id ? { ...change, [key]: value, confirmedAt: "" } : change
    ),
  };
}

export function patchMidShiftReading(report, id, rowId, value) {
  return {
    ...report,
    midShiftPriceChanges: (report.midShiftPriceChanges || []).map((change) =>
      change.id === id
        ? { ...change, readings: { ...(change.readings || {}), [rowId]: value }, confirmedAt: "" }
        : change
    ),
  };
}

export function removeMidShiftChange(report, id) {
  return {
    ...report,
    midShiftPriceChanges: (report.midShiftPriceChanges || []).filter((change) => change.id !== id),
  };
}
