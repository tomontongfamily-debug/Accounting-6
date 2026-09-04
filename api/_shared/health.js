import { BRANCHES, SHIFT_IDS } from "./supabase.js";
import { isMaboloPreOpeningSlot } from "../../src/opening-health.js";

export function manilaDateOffset(days = 0) {
  const now = new Date();
  const manilaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const date = new Date(`${manilaDate}T00:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function activeDeposits(report = {}) {
  return (report.deposits || []).filter((row) => !row.removed);
}

export function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isOpeningSetup(report = {}) {
  return report.baselineReport === true;
}

const removedDeductionKeys = new Set(["calibration" + "Cash"]);

function countedDeductions(deductions = {}) {
  return Object.entries(deductions).filter(([key]) => !removedDeductionKeys.has(key));
}

function pumpRowSales(report, row) {
  const opening = numberValue(row.opening);
  const closing = numberValue(row.closing);
  if (opening <= 0 || closing <= opening) return { liters: 0, sales: 0 };
  let currentReading = opening;
  let currentPrice = Math.max(0, numberValue(report.prices?.[row.product]));
  let sales = 0;
  (report.midShiftPriceChanges || [])
    .filter((change) => change.product === row.product)
    .sort((a, b) => String(a.effectiveTime || "").localeCompare(String(b.effectiveTime || "")))
    .forEach((change) => {
      const reading = numberValue(change.readings?.[row.id]);
      if (numberValue(change.newPrice) <= 0 || reading <= currentReading || reading >= closing) return;
      sales += (reading - currentReading) * currentPrice;
      currentReading = reading;
      currentPrice = Math.max(0, numberValue(change.newPrice));
    });
  sales += (closing - currentReading) * currentPrice;
  return { liters: closing - opening, sales };
}

export function computeReportCash(report = {}) {
  const fuelByProduct = {};
  (report.pumpRows || []).forEach((row) => {
    const totals = fuelByProduct[row.product] || { liters: 0, sales: 0, calibration: 0 };
    const rowResult = pumpRowSales(report, row);
    totals.liters += rowResult.liters;
    totals.sales += rowResult.sales;
    fuelByProduct[row.product] = totals;
  });
  (report.tankRows || []).forEach((row) => {
    const totals = fuelByProduct[row.product] || { liters: 0, sales: 0, calibration: 0 };
    totals.calibration += numberValue(row.calibration);
    fuelByProduct[row.product] = totals;
  });
  const fuelSales = Object.values(fuelByProduct).reduce((sum, totals) => {
    const returnedCalibration = Math.min(totals.liters, totals.calibration);
    const averagePrice = totals.liters > 0 ? totals.sales / totals.liters : 0;
    return sum + Math.max(0, totals.sales - returnedCalibration * averagePrice);
  }, 0);
  const poTotal = (report.poRows || []).reduce((sum, row) => sum + numberValue(row.amount), 0);
  const purchaseTotal = (report.purchaseRows || []).reduce((sum, row) => sum + numberValue(row.amount), 0);
  const deductionTotal = countedDeductions(report.deductions || {}).reduce((sum, [, value]) => sum + numberValue(value), 0)
    + poTotal
    + purchaseTotal;
  const grossSales = fuelSales + numberValue(report.oilSales);
  const deposits = activeDeposits(report);
  const bankDeposit = deposits.reduce((sum, row) => sum + numberValue(row.amount), 0);
  const expectedCash = grossSales - deductionTotal;
  const pendingCashOnHand = Math.max(0, expectedCash - bankDeposit);
  const cashVariance = bankDeposit + pendingCashOnHand - expectedCash;
  return { grossSales, bankDeposit, expectedCash, pendingCashOnHand, cashVariance };
}

export function buildDailyHealth({ reportRows = [], date }) {
  const reportsByKey = Object.fromEntries((reportRows || []).map((row) => [row.report_key, row.data || {}]));
  const stationRows = BRANCHES.map((branch) => {
    const shifts = SHIFT_IDS.map((shiftId) => {
      const report = reportsByKey[`${branch}__${date}__${shiftId}`];
      if (isMaboloPreOpeningSlot(branch, date, shiftId)) return { shiftId, status: "Not Required", depositStatus: "Not Required", cashVariance: 0 };
      if (!report) return { shiftId, status: "Missing", depositStatus: "No Report", cashVariance: 0 };
      if (isOpeningSetup(report)) return { shiftId, status: "Submitted", depositStatus: "Not Required", cashVariance: 0 };
      if (!report.confirmed) return { shiftId, status: "Draft", depositStatus: "Draft", cashVariance: 0 };
      const deposits = activeDeposits(report);
      const cash = computeReportCash(report);
      return {
        shiftId,
        status: "Submitted",
        depositStatus: deposits.length ? deposits.some((deposit) => !deposit.verified) ? "Deposit Pending" : "Deposit Saved" : "Deposit Missing",
        cashVariance: cash.cashVariance,
      };
    });

    return {
      branch,
      submitted: shifts.filter((shift) => shift.status === "Submitted").length,
      missing: shifts.filter((shift) => shift.status === "Missing").length,
      drafts: shifts.filter((shift) => shift.status === "Draft").length,
      depositMissing: shifts.filter((shift) => shift.depositStatus === "Deposit Missing").length,
      depositPending: shifts.filter((shift) => shift.depositStatus === "Deposit Pending").length,
      cashVariance: shifts.reduce((sum, shift) => sum + numberValue(shift.cashVariance), 0),
      shifts,
    };
  });

  return {
    date,
    generatedAt: new Date().toISOString(),
    submitted: stationRows.reduce((sum, row) => sum + row.submitted, 0),
    missing: stationRows.reduce((sum, row) => sum + row.missing, 0),
    drafts: stationRows.reduce((sum, row) => sum + row.drafts, 0),
    depositMissing: stationRows.reduce((sum, row) => sum + row.depositMissing, 0),
    depositPending: stationRows.reduce((sum, row) => sum + row.depositPending, 0),
    cashVariance: stationRows.reduce((sum, row) => sum + numberValue(row.cashVariance), 0),
    stations: stationRows,
  };
}
