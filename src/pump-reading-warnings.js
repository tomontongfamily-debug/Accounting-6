function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const MAX_PUMP_LITERS_PER_SHIFT = 1500;

export function blockingPumpReadings(report = {}, maximumLiters = MAX_PUMP_LITERS_PER_SHIFT) {
  return (report.pumpRows || [])
    .flatMap((row) => {
      if (!row.closingEntered) return [];
      const opening = numeric(row.opening);
      const closing = numeric(row.closing);
      const liters = closing - opening;
      if (liters >= 0 && liters <= maximumLiters) return [];
      return [{
        rowId: row.id,
        pump: row.pump,
        nozzle: row.nozzle,
        product: row.product,
        opening,
        closing,
        liters,
        variance: liters,
        kind: liters < 0 ? "negative" : "high",
        maximumLiters,
      }];
    });
}

export function negativePumpReadings(report = {}) {
  return blockingPumpReadings(report).filter((warning) => warning.kind === "negative");
}
