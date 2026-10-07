export function midShiftPumpKey(row) {
  return `${row.pump}|${row.nozzle}|${row.product}`;
}

export function midShiftReadingValue(change, row) {
  const readings = change.readings || {};
  return readings[midShiftPumpKey(row)] ?? readings[row.id] ?? "";
}

// Meter totals must move forward as prices change, including across midnight.
export function midShiftReadingIssues(report) {
  const issues = [];
  const order = change => {
    const [hours, minutes] = String(change.effectiveTime || '').split(':').map(Number);
    const value = hours * 60 + minutes;
    return report.shiftId === 'shift-3' && value < 240 ? value + 1440 : value;
  };
  for (const row of report.pumpRows || []) {
    let previous = Number(row.opening);
    const changes = (report.midShiftPriceChanges || []).filter(c => c.product === row.product).sort((a, b) => order(a) - order(b));
    for (const change of changes) {
      const raw = midShiftReadingValue(change, row), reading = Number(raw);
      if (raw === '' || raw == null || !Number.isFinite(reading) || reading < previous
          || ((row.closingEntered || report.confirmed) && reading > Number(row.closing))) {
        issues.push(`${row.pump} ${row.nozzle}: price-change readings must increase from opening to closing in time order.`);
      } else previous = reading;
    }
  }
  return [...new Set(issues)];
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
