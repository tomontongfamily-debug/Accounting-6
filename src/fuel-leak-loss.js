import {midShiftReadingValue, reportStartingPrice} from './mid-shift-price-change.js';
import {midShiftChangeOrder} from './mid-shift-sales-breakdown.js';

const products = ['Premium', 'Regular', 'Diesel'];
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const emptyTotals = () => Object.fromEntries(products.map(product => [product, 0]));

export function hasPumpOpening(row) {
  return row.opening!==''&&row.opening!=null&&Number.isFinite(Number(row.opening))&&Number(row.opening)>=0&&(Number(row.opening)>0||row.setupRequired===false);
}

export function pumpMeterLiters(row) {
  return hasPumpOpening(row) ? Math.max(0, number(row.closing) - number(row.opening)) : 0;
}

export function pumpLeakLiters(report, row) {
  return (Array.isArray(report.fuelLeakLosses)?report.fuelLeakLosses:[]).filter(loss => loss && loss.pumpRowId === row.id && loss.product === row.product)
    .reduce((sum, loss) => sum + Math.max(0, number(loss.liters)), 0);
}

export function pumpSaleLiters(report, row) {
  return Math.max(0, pumpMeterLiters(row) - pumpLeakLiters(report, row));
}

export function pumpMeterSales(report, row) {
  if(pumpMeterLiters(row)<=0)return 0;
  let reading=number(row.opening),price=Math.max(0,number(reportStartingPrice(report,row.product))),sales=0;
  const changes=(report.midShiftPriceChanges||[]).filter(change=>change.product===row.product)
    .slice().sort((a,b)=>midShiftChangeOrder(a,report.shiftId)-midShiftChangeOrder(b,report.shiftId));
  for(const change of changes) {
    const next=number(midShiftReadingValue(change,row));
    if(number(change.newPrice)<=0||next<reading||next<number(row.opening)||next>number(row.closing))continue;
    sales+=(next-reading)*price;reading=next;price=Math.max(0,number(change.newPrice));
  }
  return sales+(number(row.closing)-reading)*price;
}

// Missing units identify historical litres; keep their original meaning.
export function calibrationAmount(report, row) {
  if(row.calibrationUnit==='PHP')return Math.max(0,number(row.calibration));
  const pumps=(report.pumpRows||[]).filter(pump=>pump.product===row.product);
  const volume=pumps.reduce((sum,pump)=>sum+pumpMeterLiters(pump),0);
  const sales=pumps.reduce((sum,pump)=>sum+pumpMeterSales(report,pump),0);
  const price=volume>0?sales/volume:Math.max(0,number(reportStartingPrice(report,row.product)));
  return Math.max(0,number(row.calibration))*price;
}

export function calibrationPesoEntry(row,value) {
  return {...row,calibration:value,calibrationUnit:'PHP'};
}

export function returnedCalibrationSummary(report) {
  return products.map(product => {
    const pumps=(report.pumpRows || []).filter(row=>row.product===product);
    const meteredLiters=pumps.reduce((sum,row)=>sum+pumpMeterLiters(row),0);
    const grossSales=pumps.reduce((sum,row)=>sum+pumpMeterSales(report,row),0);
    const leakLiters=pumps.reduce((sum,row)=>sum+pumpLeakLiters(report,row),0);
    const averagePrice=meteredLiters>0?grossSales/meteredLiters:0;
    const tanks=(report.tankRows||[]).filter(row=>row.product===product);
    const legacyLiters=tanks.filter(row=>row.calibrationUnit!=='PHP').reduce((sum,row)=>sum+Math.max(0,number(row.calibration)),0);
    const pesoAmount=tanks.filter(row=>row.calibrationUnit==='PHP').reduce((sum,row)=>sum+Math.max(0,number(row.calibration)),0);
    const calibrationLiters=legacyLiters+(averagePrice>0?pesoAmount/averagePrice:0);
    const amount=legacyLiters*averagePrice+pesoAmount;
    const leakSales=pumps.reduce((sum,row)=>sum+pumpLeakSales(report,row,pump=>pumpMeterSales(report,pump)),0);
    return {product,meteredLiters,calibrationLiters,amount,pesoAmount,averagePrice,
      availableLiters:Math.max(0,meteredLiters-leakLiters),availableSales:Math.max(0,grossSales-leakSales),
      salesAdjustment:Math.min(grossSales,amount)};
  });
}

export function validateReturnedCalibration(report) {
  for(const row of report.tankRows || []) {
    if(row.calibrationUnit!=null&&!['PHP','L'].includes(row.calibrationUnit))return `${row.product}: invalid calibration unit.`;
    if(row.calibration!==''&&row.calibration!=null&&(!Number.isFinite(Number(row.calibration))||Number(row.calibration)<0))return `${row.product}: calibration must be a non-negative ${row.calibrationUnit==='PHP'?'peso amount':'number of litres'}.`;
    if(row.calibrationUnit==='PHP'&&Math.abs(number(row.calibration)*100-Math.round(number(row.calibration)*100))>0.000001)return `${row.product}: enter calibration pesos with no more than two decimal places.`;
  }
  for(const row of returnedCalibrationSummary(report)) {
    if(row.pesoAmount>0&&row.averagePrice<=0)return `${row.product}: calibration pesos require completed pump readings and a positive selling price.`;
    if(row.pesoAmount>0&&row.amount>row.availableSales+0.000001)return `${row.product}: calibration amount cannot exceed available metered fuel sales after leak loss.`;
    if(row.calibrationLiters>row.meteredLiters+0.000001)return `${row.product}: returned calibration (${row.calibrationLiters.toFixed(2)} L) cannot exceed the pump reading difference (${row.meteredLiters.toFixed(2)} L). Enter litres returned to the tank, not pesos.`;
    if(row.calibrationLiters>row.availableLiters+0.000001)return 'Calibration and metered leak loss cannot exceed the total pump volume.';
  }
  return '';
}

export function pumpSalesBreakdown(report,row) {
  const meteredLiters=pumpMeterLiters(row),lossLiters=pumpLeakLiters(report,row),grossSales=pumpMeterSales(report,row);
  const lossSales=pumpLeakSales(report,row,pump=>pumpMeterSales(report,pump));
  return {meteredLiters,lossLiters,paidLiters:pumpSaleLiters(report,row),grossSales,lossSales,
    paidSales:Math.max(0,grossSales-lossSales),excessLoss:lossLiters>meteredLiters+0.000001};
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
  return validateReturnedCalibration(report);
}
