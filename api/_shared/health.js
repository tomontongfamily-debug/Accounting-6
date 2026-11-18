import { BRANCHES, SHIFT_IDS } from "./supabase.js";
import { isStationPreOpeningSlot, openingSlotHealth } from "../../src/opening-health.js";
import { pumpMeterLiters, pumpMeterSales } from "../../src/fuel-leak-loss.js";
import { compute } from "../../src/accounting-engine.js";

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

function reportTotals(report) {
  // Health checks and owner messages must use the report screen's price-change,
  // loss, deduction and physical-cash rules. Partial historical rows are allowed.
  return compute({
    ...report,
    pumpRows: report.pumpRows || [],
    tankRows: report.tankRows || [],
    poRows: report.poRows || [],
    purchaseRows: report.purchaseRows || [],
    deductions: report.deductions || {},
    coke: report.coke || {},
  });
}

const removedDeductionKeys = new Set(["calibration" + "Cash"]);

function countedDeductions(deductions = {}) {
  return Object.entries(deductions).filter(([key]) => !removedDeductionKeys.has(key));
}

export function computeReportFuel(report = {}) {
  if (report.branch === "Liloan" || report.pilot === true) {
    const totals = reportTotals(report);
    return { liters: totals.totalLiters, sales: totals.fuelSales };
  }
  const fuelByProduct = {};
  (report.pumpRows || []).forEach((row) => {
    const totals = fuelByProduct[row.product] || { liters: 0, sales: 0, calibration: 0 };
    totals.liters += pumpMeterLiters(row);
    totals.sales += pumpMeterSales(report, row);
    fuelByProduct[row.product] = totals;
  });
  (report.tankRows || []).forEach((row) => {
    const totals = fuelByProduct[row.product] || { liters: 0, sales: 0, calibration: 0 };
    totals.calibration += numberValue(row.calibration);
    fuelByProduct[row.product] = totals;
  });
  return Object.values(fuelByProduct).reduce((result, totals) => {
    const returnedCalibration = Math.min(totals.liters, totals.calibration);
    const averagePrice = totals.liters > 0 ? totals.sales / totals.liters : 0;
    result.liters += Math.max(0, totals.liters - returnedCalibration);
    result.sales += Math.max(0, totals.sales - returnedCalibration * averagePrice);
    return result;
  }, { liters: 0, sales: 0 });
}

export function computeReportCash(report = {}) {
  if (report.branch === "Liloan" || report.pilot === true) {
    const { grossSales, bankDeposit, expectedCash, pendingCashOnHand, cashVariance } = reportTotals(report);
    return { grossSales, bankDeposit, expectedCash, pendingCashOnHand, cashVariance };
  }
  const fuelSales = computeReportFuel(report).sales;
  const poTotal = (report.poRows || []).reduce((sum, row) => sum + numberValue(row.amount), 0);
  const purchaseTotal = (report.purchaseRows || []).reduce((sum, row) => sum + numberValue(row.amount), 0);
  const deductionTotal = countedDeductions(report.deductions || {}).reduce((sum, [, value]) => sum + numberValue(value), 0)
    + poTotal
    + purchaseTotal;
  const grossSales = fuelSales + numberValue(report.oilSales);
  const deposits = activeDeposits(report);
  const bankDeposit = deposits.reduce((sum, row) => sum + numberValue(row.amount), 0);
  const expectedCash = grossSales - deductionTotal;
  const pendingCashOnHand = report.pilot && Number.isFinite(report.pilotCashAwaitingDeposit)
    ? report.pilotCashAwaitingDeposit : Math.max(0, expectedCash - bankDeposit);
  const cashVariance = report.pilot && report.actualCashCounted!=='' && report.actualCashCounted!=null
    ? numberValue(report.actualCashCounted)-expectedCash : bankDeposit + pendingCashOnHand - expectedCash;
  return { grossSales, bankDeposit, expectedCash, pendingCashOnHand, cashVariance };
}

export function buildDailyHealth({ reportRows = [], date }) {
  const reportsByKey = Object.fromEntries((reportRows || []).map((row) => [row.report_key, row.data || {}]));
  const stationRows = BRANCHES.map((branch) => {
    const shifts = SHIFT_IDS.map((shiftId) => {
      const report = reportsByKey[`${branch}__${date}__${shiftId}`];
      if (isStationPreOpeningSlot(branch, date, shiftId)) return { shiftId, status: "Not Required", depositStatus: "Not Required", cashVariance: 0 };
      const openingStatus = openingSlotHealth(report, branch, date, shiftId);
      if (openingStatus?.label === "Submitted") return { shiftId, status: "Submitted", detail: openingStatus.detail, depositStatus: "Not Required", cashVariance: 0 };
      if (!report) return { shiftId, status: "Missing", depositStatus: "No Report", cashVariance: 0 };
      if (isOpeningSetup(report)) return { shiftId, status: "Submitted", depositStatus: "Not Required", cashVariance: 0 };
      if (!report.confirmed) return { shiftId, status: "Draft", depositStatus: "Draft", cashVariance: 0 };
      const deposits = activeDeposits(report);
      const cash = computeReportCash(report);
      return {
        shiftId,
        status: "Submitted",
        depositStatus: report.pilot && report.depositCoverage ? report.depositCoverage.status==='verified' ? 'Deposit Saved' : 'Deposit Pending' : deposits.length ? deposits.some((deposit) => !deposit.verified) ? "Deposit Pending" : "Deposit Saved" : "Deposit Missing",
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
