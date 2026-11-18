import { midShiftChangeOrder, midShiftTimeError } from "./shift-time.js";
import {validTemporaryManualPriceReading} from './temporary-price-reading.js';

export function midShiftPumpKey(row) {
  return `${row.pump}|${row.nozzle}|${row.product}`;
}

export function midShiftReadingValue(change, row) {
  const readings = change.readings || {};
  return readings[midShiftPumpKey(row)] ?? readings[row.id] ?? "";
}

export function numericMidShiftReading(change, row) {
  const raw = midShiftReadingValue(change, row);
  if ((typeof raw !== "string" && typeof raw !== "number") || String(raw).trim() === "") return null;
  const reading = Number(raw);
  return Number.isFinite(reading) && reading >= 0 ? reading : null;
}

export function midShiftPhotoRow(change, row, report) {
  const evidence=change.readingPhotos?.[midShiftPumpKey(row)]||{};
  return {...row,...evidence,closing:midShiftReadingValue(change,row),photo_path:evidence.photo_path||'',readingConfirmed:!!evidence.readingConfirmed,closingEntered:!!evidence.readingConfirmed,readingRevision:evidence.readingRevision||0,finalClosing:row.closingEntered?row.closing:'',temporaryManualConfirmed:validTemporaryManualPriceReading(report,change,row,evidence)};
}

export function midShiftReadingComplete(report,change,row){
  const photo=midShiftPhotoRow(change,row,report),value=numericMidShiftReading(change,row);
  return Boolean((photo.photo_path||photo.temporaryManualConfirmed)&&photo.readingConfirmed&&value!==null&&Number(value)>=Number(row.opening)&&(!row.closingEntered||Number(value)<=Number(row.closing)));
}

export function pendingPricePhotoChanges(report) {
  return (report.midShiftPriceChanges||[]).filter(change=>!change.confirmedAt&&change.effectiveTime&&Number(change.newPrice)>0);
}

export function pendingPricePhotoTasks(reports, branch, date) {
  return Object.values(reports||{}).filter(report=>report.branch===branch&&report.date===date&&!report.confirmed&&!report.baselineReport)
    .sort((a,b)=>a.shiftId.localeCompare(b.shiftId)).flatMap(report=>(report.midShiftPriceChanges||[])
      .filter(change=>!change.confirmedAt&&midShiftChangeHasDetails(change)).map(change=>{
        const rows=(report.pumpRows||[]).filter(row=>row.product===change.product);
        const missing=rows.filter(row=>!midShiftReadingComplete(report,change,row));
        return {reportKey:`${report.branch}__${report.date}__${report.shiftId}`,branch:report.branch,date:report.date,shiftId:report.shiftId,changeId:change.id,product:change.product,effectiveTime:change.effectiveTime,
          total:rows.length,done:rows.length-missing.length,nextNozzle:missing[0]?`${missing[0].pump} ${missing[0].nozzle}`:'',needsSetup:!change.effectiveTime||Number(change.newPrice)<=0};
      }));
}

// Opening an optional change card saves a blank draft, not an actual price change.
// Keep partial entries active so unfinished real changes still block submission.
export function midShiftChangeHasDetails(change) {
  const entered = value => value != null && String(value).trim() !== '' && Number(value) !== 0;
  return Boolean(String(change.effectiveTime || '').trim() || change.confirmedAt
    || entered(change.newPrice)
    || Object.values(change.readings || {}).some(entered)
    || Object.values(change.readingPhotos || {}).some(photo => photo?.photo_path || photo?.photoId || photo?.readingConfirmed));
}

export function midShiftSubmissionIssue(report) {
  const changes = (report.midShiftPriceChanges || []).filter(midShiftChangeHasDetails);
  if (!changes.length) return "";
  for (const change of changes) {
    const timeError = midShiftTimeError(change.effectiveTime, report.shiftId);
    if (timeError) return `${change.product} price change: ${timeError}`;
    if (!Number.isFinite(Number(change.newPrice)) || Number(change.newPrice) <= 0)
      return `Enter the new ${change.product} price for the ${change.effectiveTime} change before submission.`;
    if (change.photoRequired && !change.confirmedAt) {
      const missing = (report.pumpRows || []).find(row => row.product === change.product && !midShiftReadingComplete(report, change, row));
      return missing
        ? `Photograph and confirm ${missing.pump} ${missing.nozzle} for the ${change.effectiveTime} ${change.product} price change before submission.`
        : `Manager must confirm the ${change.effectiveTime} ${change.product} price change before submission.`;
    }
  }
  return midShiftReadingIssues(report)[0] || "";
}

// Meter totals must move forward as prices change, including across midnight.
export function midShiftReadingIssues(report) {
  const issues = [];
  for (const row of report.pumpRows || []) {
    let previous = Number(row.opening);
    const changes = (report.midShiftPriceChanges || []).filter(c => c.product === row.product && midShiftChangeHasDetails(c)).sort((a, b) => midShiftChangeOrder(a, report.shiftId) - midShiftChangeOrder(b, report.shiftId));
    for (const change of changes) {
      const reading = numericMidShiftReading(change, row);
      const label = `${row.pump} ${row.nozzle} · ${change.product} at ${change.effectiveTime || "time pending"}`;
      if (reading === null) issues.push(`${label}: enter the meter reading at the price change.`);
      else if (reading < previous) issues.push(`${label}: ${reading} is below ${previous}. Check the readings in time order.`);
      else if ((row.closingEntered || report.confirmed) && reading > Number(row.closing))
        issues.push(`${label}: the price-change reading ${reading} exceeds the closing reading ${row.closing}.`);
      else previous = reading;
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
  const hasMidShiftChange = (report.midShiftPriceChanges || []).some((change) => change.product === product && midShiftChangeHasDetails(change));
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
      change.id === id
        ? key === 'product' && change.product !== value
          ? { ...change, product: value, newPrice: '', readings: {}, readingPhotos: {}, confirmedAt: '' }
          : key === "effectiveTime" && change.effectiveTime !== value && (change.photoRequired || Object.keys(change.readingPhotos || {}).length > 0)
            ? { ...change, effectiveTime: value, readings: {}, readingPhotos: {}, confirmedAt: "" }
            : { ...change, [key]: value, confirmedAt: "" }
        : change
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
