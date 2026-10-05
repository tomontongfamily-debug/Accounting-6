import {reportStartingPrice} from './mid-shift-price-change.js';

const products = ['Premium', 'Regular', 'Diesel'];
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const emptyTotals = () => Object.fromEntries(products.map(product => [product, 0]));

export function pumpMeterLiters(row) {
  return number(row.opening) > 0 ? Math.max(0, number(row.closing) - number(row.opening)) : 0;
}

export function pumpLeakLiters(report, row) {
  return (report.fuelLeakLosses || []).filter(loss => loss.pumpRowId === row.id && loss.product === row.product)
    .reduce((sum, loss) => sum + Math.max(0, number(loss.liters)), 0);
}

export function pumpSaleLiters(report, row) {
  return Math.max(0, pumpMeterLiters(row) - pumpLeakLiters(report, row));
}

export function fuelLeakPriceOptions(report, product) {
  return [...new Set([reportStartingPrice(report, product), ...(report.midShiftPriceChanges || []).filter(change => change.product === product).map(change => change.newPrice)].map(Number).filter(value => Number.isFinite(value) && value > 0))];
}

export function fuelLeakSalesForLoss(report, loss, rowSales) {
  const pump = report.pumpRows.find(row => row.id === loss.pumpRowId && row.product === loss.product);
  if (!pump) return 0;
  const choices = fuelLeakPriceOptions(report, loss.product);
  const selectedPrice = Number(loss.pricePerLiter);
  const price = choices.length > 1 && choices.includes(selectedPrice) ? selectedPrice
    : choices.length === 1 ? choices[0] : pumpMeterLiters(pump) > 0 ? rowSales(pump) / pumpMeterLiters(pump) : 0;
  return Math.max(0, number(loss.liters)) * price;
}

export function pumpLeakSales(report, row, rowSales) {
  return (report.fuelLeakLosses || []).filter(loss => loss.pumpRowId === row.id && loss.product === row.product)
    .reduce((sum, loss) => sum + fuelLeakSalesForLoss(report, loss, rowSales), 0);
}

export function fuelLeakLossSummary(report, rowSales) {
  const meteredLiters = emptyTotals(), tankLiters = emptyTotals(), meteredSales = emptyTotals();
  for (const loss of report.fuelLeakLosses || []) {
    if (!products.includes(loss.product)) continue;
    const liters = Math.max(0, number(loss.liters));
    if (loss.pumpRowId) {
      const pump = (report.pumpRows || []).find(row => row.id === loss.pumpRowId && row.product === loss.product);
      if (!pump) continue;
      meteredLiters[loss.product] += liters;
      meteredSales[loss.product] += fuelLeakSalesForLoss(report, loss, rowSales);
    } else {
      tankLiters[loss.product] += liters;
    }
  }
  return {meteredLiters, tankLiters, meteredSales,
    liters: products.reduce((sum, product) => sum + meteredLiters[product] + tankLiters[product], 0),
    sales: products.reduce((sum, product) => sum + meteredSales[product], 0)};
}

export function validateFuelLeakLosses(report, {requireNotes = false} = {}) {
  if (report.fuelLeakLosses != null && !Array.isArray(report.fuelLeakLosses)) return 'Invalid fuel leak loss entries.';
  const ids = new Set(), byPump = new Map();
  for (const loss of report.fuelLeakLosses || []) {
    if (!loss || !loss.id || ids.has(loss.id)) return 'Each fuel leak loss needs a unique reference.';
    ids.add(loss.id);
    if (!products.includes(loss.product) || !(report.tankRows || []).some(row => row.product === loss.product)) return 'Select the tank product for fuel leak loss.';
    if (loss.liters === '' || loss.liters == null) continue; // An unfinished draft entry is allowed.
    if (!Number.isFinite(Number(loss.liters)) || Number(loss.liters) < 0) return 'Fuel leak loss liters must be a non-negative number.';
    if (requireNotes && Number(loss.liters) > 0 && !String(loss.notes || '').trim()) return 'Explain each fuel leak loss before submitting.';
    if (loss.pumpRowId) {
      const pump = (report.pumpRows || []).find(row => row.id === loss.pumpRowId && row.product === loss.product);
      if (!pump) return 'The leak loss pump must belong to the selected product and report.';
      const prices = fuelLeakPriceOptions(report, loss.product);
      if (Number(loss.liters) > 0 && prices.length > 1 && !prices.includes(Number(loss.pricePerLiter))) return 'Select the selling price at the time of the metered leak loss.';
      byPump.set(pump.id, (byPump.get(pump.id) || 0) + Number(loss.liters));
      if (byPump.get(pump.id) > pumpMeterLiters(pump) + 0.000001) return 'Metered leak loss cannot exceed the pump reading difference.';
    }
  }
  for (const product of products) {
    const pumps = (report.pumpRows || []).filter(row => row.product === product);
    const metered = pumps.reduce((sum, row) => sum + (byPump.get(row.id) || 0), 0);
    const calibration = (report.tankRows || []).filter(row => row.product === product).reduce((sum, row) => sum + Math.max(0, number(row.calibration)), 0);
    if (metered > 0 && metered + calibration > pumps.reduce((sum, row) => sum + pumpMeterLiters(row), 0) + 0.000001) return 'Calibration and metered leak loss cannot exceed the total pump volume.';
  }
  return '';
}
