import { useEffect, useMemo, useRef, useState } from "react";
import { cashierReportDateDisplay } from "./cashier-date.js";
import { OWNER_PERIOD_OPTIONS, ownerCashTrendRows, ownerPeriodRange, ownerReportsForPeriod } from "./owner-period.js";
import { blockingPumpReadings, MAX_PUMP_LITERS_PER_SHIFT } from "./pump-reading-warnings.js";
import { committedManagerPrice, insertManagerPriceDecimal, normalizeManagerPriceDraft } from "./managerPrice.js";
import { depositAllocationDifference, physicalCashVariance } from "./cash-variance.js";
import { buildReviewMessage } from "./review-message.js";
import { formatCashCountInput, normalizeCashCountInput } from "./cash-count-input.js";
import { isMaboloPreOpeningSlot } from "./opening-health.js";
import { normalizeBranchPinDraft } from "./pin-input.js";
import { shiftIdForEffectiveTime } from "./shift-time.js";
import { isCleanRestartRejection, shouldDiscardOfflineReport } from "./offline-report.js";
import {
  addMidShiftChange,
  ensureMidShiftBasePrices,
  midShiftPumpKey,
  midShiftReadingValue,
  patchMidShiftChange,
  patchMidShiftReading,
  reportStartingPrice,
  removeMidShiftChange,
} from "./mid-shift-price-change.js";
import { midShiftChangeOrder, midShiftReadingRows, midShiftSalesBreakdown } from "./mid-shift-sales-breakdown.js";
import { applyEffectivePricing } from "./report-price-sync.js";
import { subscribeToStoreChanges } from "./realtime-store.js";

const BRANCHES = ["Mabolo", "Arpili", "Liloan", "Pondol", "Barili", "Moalboal"];
const HEALTH_BRANCH_OPTIONS = ["All Stations", ...BRANCHES];
const FUEL_TYPES = ["Premium", "Regular", "Diesel"];
const CASH_VOUCHER_CATEGORIES = ["OPEX", "Personal", "Construction"];
const CASH_VOUCHER_START_DATE = "2026-07-29";
const SHIFT_OPTIONS = [
  { id: "shift-1", label: "Shift 1 - 4:00 AM to 1:00 PM" },
  { id: "shift-2", label: "Shift 2 - 1:00 PM to 10:00 PM" },
  { id: "shift-3", label: "Shift 3 - 10:00 PM to 4:00 AM" },
];
const DEPOSIT_COVERAGE_OPTIONS = [
  { value: "shift-1", label: "Shift 1" },
  { value: "shift-2", label: "Shift 2" },
  { value: "shift-3", label: "Shift 3" },
  { value: "shift-2-3", label: "Shift 2 + Shift 3" },
  { value: "all", label: "All Shifts" },
];
const PRICING_COVERAGE_OPTIONS = ["Daily", "Shift"];
const RANKING_RANGE_OPTIONS = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly", "All-time"];
const MOBILE_PERFORMANCE_PERIODS = ["Shift", "Daily", "Weekly", "Monthly", "Quarterly", "Yearly", "All-time"];
const BASELINE_MESSAGE = "No previous closing record found. Enter and confirm the starting opening values before this report can be counted.";
const REVIEW_LITERS_THRESHOLD = 10000;
const REVIEW_CASH_VARIANCE_THRESHOLD = 1500;
const REVIEW_CASH_OVERAGE_THRESHOLD = 100;
const ENTRY_REVIEW_HINT_THRESHOLD = 5000;
const CASH_SHORTAGE_ALERT_THRESHOLD = 100;
const CRITICAL_GROSS_SALES_THRESHOLD = 10000000;
const CRITICAL_LITERS_THRESHOLD = 50000;
const REPORT_HISTORY_RESET_AT = "2026-07-30T06:20:49.061Z";
const PRICE_HISTORY_RESET_AT = "2026-07-30T06:20:49.061Z";
const MISSING_SHIFT_WARNING_START_DATE = "2026-07-29";
const GLOBAL_OPENING_DATE = "2026-07-29";
const GLOBAL_OPENING_SHIFT_ID = "shift-3";
const PO_INTEGRATION_START_DATE = "2026-08-19";
const GLOBAL_REPORTING_START_DATE = "2026-07-30";
const REPORT_SAVE_DEBOUNCE_MS = 650;
const LOCAL_DRAFT_CACHE_DEBOUNCE_MS = 180;
const TODAY = localDateKey();
const STORE_KEY = "fueltech-official-branch-reporting-v2";
const OFFLINE_QUEUE_KEY = "fueltech-report-offline-queue-v2";
const LOCAL_DRAFTS_KEY = "fueltech-report-local-drafts-v1";
const LOCAL_WIZARD_STEPS_KEY = "fueltech-cashier-wizard-steps-v1";
const CASHIER_SESSION_CACHE_KEY = "fueltech-cashier-session-v1";
const PUMP_CONFIG_VERSION = "2026-07-25-mabolo-pump-5";
const PUMP_LAYOUTS = {
  Mabolo: [
    ["Premium", "Regular1", "Regular2", "Diesel"],
    ["Premium", "Regular1", "Regular2", "Diesel"],
    ["Premium", "Regular1", "Regular2", "Diesel"],
    ["Premium", "Regular1", "Regular2", "Diesel"],
    ["Premium", "Regular1", "Regular2", "Diesel"],
  ],
  Arpili: [
    ["Premium", "Regular", "Diesel"],
    ["Premium", "Regular", "Diesel"],
    ["Premium", "Regular", "Diesel"],
    ["Premium", "Regular", "Diesel"],
  ],
  Liloan: [
    ["Premium", "Regular1", "Regular2", "Diesel"],
    ["Premium", "Regular1", "Regular2", "Diesel"],
  ],
  Pondol: [
    ["Premium1", "Premium2", "Regular1", "Regular2", "Diesel1", "Diesel2"],
    ["Premium1", "Premium2", "Regular1", "Regular2", "Diesel1", "Diesel2"],
    ["Premium", "Regular", "Diesel"],
    ["Premium", "Regular", "Diesel"],
  ],
  Barili: [
    ["Premium1", "Premium2", "Regular1", "Regular2", "Diesel1", "Diesel2"],
    ["Premium1", "Premium2", "Regular1", "Regular2", "Diesel1", "Diesel2"],
    ["Premium", "Regular", "Diesel"],
    ["Premium", "Regular", "Diesel"],
  ],
  Moalboal: [
    ["Premium", "Regular", "Diesel"],
    ["Premium", "Regular", "Diesel"],
    ["Premium", "Regular", "Diesel"],
    ["Premium", "Regular", "Diesel"],
  ],
};

const OWNER_DISPLAY_BRANCHES = ["Mabolo", "Liloan", "Arpili", "Pondol", "Barili", "Moalboal"];
const OWNER_ACCOUNTING_START_DATE = "2026-07-30";
const DECIMAL_INPUT_PATTERN = /^-?\d*([.,]\d*)?$/;
const DEVICE_CLIENT_ID_KEY = "fueltech-device-client-id";
const DEVICE_SAVE_VERSION_KEY = "fueltech-device-save-version";
const BRANCH_DATA_VERSIONS = {
  Mabolo: "2026-07-31-rewind-to-july-30-1",
  Arpili: "2026-07-30-arpili-opening-reset-2",
  Liloan: "2026-07-31-rewind-to-july-30-1",
  Pondol: "2026-07-30-global-reset-1",
  Barili: "2026-07-30-global-reset-1",
  Moalboal: "2026-07-30-global-reset-1",
};

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function deviceClientId() {
  try {
    const existing = window.localStorage.getItem(DEVICE_CLIENT_ID_KEY);
    if (existing) return existing;
    const created = uid();
    window.localStorage.setItem(DEVICE_CLIENT_ID_KEY, created);
    return created;
  } catch {
    return uid();
  }
}

function readDeviceSaveVersion() {
  try { return Math.max(Date.now(), Number(window.localStorage.getItem(DEVICE_SAVE_VERSION_KEY) || 0)); }
  catch { return Date.now(); }
}

function nextDeviceSaveVersion(current = 0) {
  const next = Math.max(Number(current || 0) + 1, Date.now());
  try { window.localStorage.setItem(DEVICE_SAVE_VERSION_KEY, String(next)); }
  catch {
    // The timestamp remains monotonic for the active page when storage is unavailable.
  }
  return next;
}

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function peso(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n(value));
}

function formatRefreshTime(value) {
  if (!value) return "Waiting for first sync";
  return `Last synced ${new Date(value).toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  })}`;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function liter(value) {
  return `${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(n(value))} L`;
}

function dateOffset(baseDate, days) {
  const date = new Date(`${baseDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return TODAY;
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function shiftById(id) {
  return SHIFT_OPTIONS.find((shift) => shift.id === id) || SHIFT_OPTIONS[0];
}

function depositCoverageLabel(value) {
  return DEPOSIT_COVERAGE_OPTIONS.find((option) => option.value === value)?.label || "Shift 1";
}

function depositCoverageShiftIds(value) {
  if (value === "shift-2-3") return ["shift-2", "shift-3"];
  if (value === "all") return SHIFT_OPTIONS.map((shift) => shift.id);
  return [value || "shift-1"];
}

function previousShiftFor(date, shiftId) {
  if (shiftId === "shift-2") return { date, shiftId: "shift-1" };
  if (shiftId === "shift-3") return { date, shiftId: "shift-2" };
  return { date: dateOffset(date, -1), shiftId: "shift-3" };
}

function nextShiftFor(date, shiftId) {
  if (shiftId === "shift-1") return { date, shiftId: "shift-2" };
  if (shiftId === "shift-2") return { date, shiftId: "shift-3" };
  return { date: dateOffset(date, 1), shiftId: "shift-1" };
}

function branchReportingDate(reports = {}, branch) {
  let date = GLOBAL_REPORTING_START_DATE;
  for (let checked = 0; checked < 3650; checked += 1) {
    const complete = SHIFT_OPTIONS.every((shift) => reportCompleted(reports[reportKey(branch, date, shift.id)]));
    if (!complete) return date;
    date = dateOffset(date, 1);
  }
  return GLOBAL_REPORTING_START_DATE;
}

function displayShiftLabel(branch, date, shiftId) {
  return shiftById(shiftId).label;
}

function cashierBusinessDate() {
  return getCurrentShift().date;
}

function getCurrentShift() {
  const now = new Date();
  const hour = now.getHours();
  const shiftDate = new Date(now);

  if (hour < 4) {
    shiftDate.setDate(shiftDate.getDate() - 1);
    return {
      date: localDateKey(shiftDate),
      ...SHIFT_OPTIONS[2],
    };
  }

  if (hour < 13) {
    return {
      date: localDateKey(now),
      ...SHIFT_OPTIONS[0],
    };
  }

  if (hour < 22) {
    return {
      date: localDateKey(now),
      ...SHIFT_OPTIONS[1],
    };
  }

  return {
    date: localDateKey(now),
    ...SHIFT_OPTIONS[2],
  };
}

function reportKey(branch, date, shiftId = "shift-1") {
  return `${branch}__${date}__${shiftId}`;
}

function dailyPriceKey(date) {
  return date;
}

function shiftPriceKey(date, shiftId) {
  return `${date}__${shiftId}`;
}

function roleFromPath(pathname) {
  if (pathname === "/cashier") return "Cashier";
  if (pathname === "/manager") return "Manager";
  if (pathname === "/admin") return "Admin";
  if (pathname === "/approver") return "Approver";
  return "";
}

function reopenedStartingOpeningReport(reports, branch) {
  return Object.values(reports)
    .filter((report) => report.branch === branch && report.reopenStartingOpening && !openingSetupCompleted(report))
    .sort((a, b) => `${a.date}-${a.shiftId}`.localeCompare(`${b.date}-${b.shiftId}`))[0] || null;
}

function correctionRequest(report) {
  return report?.correctionRequest || {};
}

function approvedCorrectionPayload(request) {
  return {
    ...request,
    status: "approved",
    approvedAt: new Date().toLocaleString(),
    rejectedAt: "",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function isActiveCorrectionApproval(report) {
  const request = correctionRequest(report);
  const expiresAt = Date.parse(request.expiresAt || "");
  return request.status === "approved" && !Number.isNaN(expiresAt) && expiresAt > Date.now();
}

function approvedCorrectionReport(reports, branch) {
  return Object.values(reports)
    .filter((report) => report.branch === branch && isActiveCorrectionApproval(report))
    .filter((report) => !correctionRequest(report).autoApproved)
    .sort((a, b) => `${a.date}-${a.shiftId}`.localeCompare(`${b.date}-${b.shiftId}`))[0] || null;
}

function pendingCorrectionReport(reports, branch) {
  return Object.values(reports)
    .filter((report) => report.branch === branch && correctionRequest(report).status === "pending")
    .filter((report) => !correctionRequest(report).autoApproved)
    .sort((a, b) => `${b.date}-${b.shiftId}`.localeCompare(`${a.date}-${a.shiftId}`))[0] || null;
}

function activeCorrectionRequests(reports) {
  return Object.values(reports)
    .filter((report) => ["pending", "approved"].includes(correctionRequest(report).status))
    .filter((report) => !correctionRequest(report).autoApproved)
    .sort((a, b) => `${a.date}-${a.branch}-${a.shiftId}`.localeCompare(`${b.date}-${b.branch}-${b.shiftId}`));
}

function missingPreviousShiftInfo(report, reports) {
  if (!report?.date || !report?.shiftId || reportCompleted(report) || report.baselineMissing) return null;
  const previous = previousShiftFor(report.date, report.shiftId);
  if (previous.date < MISSING_SHIFT_WARNING_START_DATE) return null;
  const previousReport = reports[reportKey(report.branch, previous.date, previous.shiftId)];
  if (reportCompleted(previousReport)) return null;
  return {
    branch: report.branch,
    currentDate: report.date,
    currentShiftId: report.shiftId,
    missingDate: previous.date,
    missingShiftId: previous.shiftId,
    missingShiftLabel: shiftById(previous.shiftId).label,
    status: previousReport ? "Draft" : "Missing",
  };
}

function missingShiftActivityRows(reports = {}) {
  return Object.values(reports)
    .flatMap((report) => (report.missingShiftActivity || []).map((activity) => ({ report, activity })))
    .sort((a, b) => String(b.activity.at || "").localeCompare(String(a.activity.at || "")));
}

async function verifyLoginPin({ role, branch, pin }) {
  const response = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role, branch, pin }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Unable to verify PIN.");
  return result;
}

async function restoreAdminLoginSession() {
  const response = await fetch("/api/auth/session", { method: "GET", cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.role !== "Admin") return null;
  return result;
}

async function endLoginSession() {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error("Unable to log out safely.");
}

async function apiPost(path, body, sessionToken = "") {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(sessionToken && sessionToken !== "cookie" ? { "x-fueltech-session": sessionToken } : {}) },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    const error = new Error(result.error || "Unable to save online.");
    Object.assign(error, result, { status: response.status });
    throw error;
  }
  return result;
}

function productFromNozzle(nozzle) {
  const x = String(nozzle).toLowerCase();
  if (x.includes("premium")) return "Premium";
  if (x.includes("regular")) return "Regular";
  return "Diesel";
}

function defaultPrices() {
  return { Premium: 0, Regular: 0, Diesel: 0 };
}

function fuelCostKey(product) {
  return `${product}Cost`;
}

function defaultFuelCosts() {
  return Object.fromEntries(FUEL_TYPES.map((product) => [fuelCostKey(product), 0]));
}

function fuelCostValuesFromPrices(prices = {}) {
  return Object.fromEntries(FUEL_TYPES.map((product) => [fuelCostKey(product), fuelCostForProduct(prices, product)]));
}

function fuelCostForProduct(prices = {}, product) {
  return n(prices[fuelCostKey(product)]);
}

function latestFuelCostsForBranch(priceBook = {}, branch, date) {
  const branchPrices = priceBook[branch] || {};
  return Object.keys(branchPrices)
    .filter((item) => !item.includes("__") && item <= date)
    .sort()
    .reduce((costs, key) => {
      const prices = branchPrices[key] || {};
      FUEL_TYPES.forEach((product) => {
        const cost = fuelCostForProduct(prices, product);
        if (cost > 0) {
          costs[fuelCostKey(product)] = cost;
          costs[`${fuelCostKey(product)}Date`] = key;
          costs[`${fuelCostKey(product)}Meta`] = prices.fuelDeliveryCostMeta || {};
        }
      });
      return costs;
    }, defaultFuelCosts());
}

const FUELTECH_PAY_KEYS = ["gcash", "card", "paymaya"];
const HIDDEN_DEDUCTION_KEYS = new Set([...FUELTECH_PAY_KEYS, "discounts"]);
const REMOVED_DEDUCTION_KEYS = new Set(["calibration" + "Cash"]);

function isFuelTechPayKey(key) {
  return FUELTECH_PAY_KEYS.includes(key);
}

function fuelTechPayTotal(deductions = {}) {
  return FUELTECH_PAY_KEYS.reduce((sum, key) => sum + n(deductions[key]), 0);
}

function pointsWithdrawnFromRedemptions(report = {}) {
  const deductions = report.deductions || {};
  return n(deductions.cashRedemption) + n(deductions.fuelRedemption);
}

function deductionLabel(key) {
  return humanizeKey(key);
}

function visibleDeductionEntries(deductions = {}) {
  return Object.entries(deductions).filter(([key]) => !HIDDEN_DEDUCTION_KEYS.has(key) && !REMOVED_DEDUCTION_KEYS.has(key));
}

function countedDeductionEntries(deductions = {}) {
  return Object.entries(deductions).filter(([key]) => !REMOVED_DEDUCTION_KEYS.has(key));
}

function cleanDeductions(deductions = {}) {
  return Object.fromEntries(countedDeductionEntries(deductions));
}

function hasActualCashCounted(report = {}) {
  return report.actualCashCounted !== "" && report.actualCashCounted !== null && report.actualCashCounted !== undefined;
}

function getEffectivePrice(priceBook, branch, date, shiftId = "shift-1") {
  return getEffectivePricing(priceBook, branch, date, shiftId).prices;
}

function getEffectivePricing(priceBook, branch, date, shiftId = "shift-1") {
  const branchPrices = priceBook[branch] || {};
  const shiftKey = shiftPriceKey(date, shiftId);

  if (branchPrices[shiftKey]) {
    return {
      prices: { ...defaultPrices(), ...branchPrices[shiftKey] },
      pricingCoverage: "Shift",
      pricingEffectiveDate: date,
      pricingShiftId: shiftId,
    };
  }

  const dailyDates = Object.keys(branchPrices)
    .filter((item) => !item.includes("__") && item <= date)
    .sort();

  if (!dailyDates.length) {
    return {
      prices: defaultPrices(),
      pricingCoverage: "Daily",
      pricingEffectiveDate: "",
      pricingShiftId: "",
    };
  }

  const effectiveDate = dailyDates[dailyDates.length - 1];
  return {
    prices: { ...defaultPrices(), ...branchPrices[effectiveDate] },
    pricingCoverage: "Daily",
    pricingEffectiveDate: effectiveDate,
    pricingShiftId: "",
  };
}

function getEffectiveDailyPricing(priceBook, branch, date) {
  const branchPrices = priceBook[branch] || {};
  const dailyDates = Object.keys(branchPrices)
    .filter((item) => !item.includes("__") && item <= date)
    .sort();

  if (!dailyDates.length) {
    return {
      prices: { ...defaultPrices(), ...defaultFuelCosts() },
      pricingEffectiveDate: "",
    };
  }

  const effectiveDate = dailyDates[dailyDates.length - 1];
  return {
    prices: { ...defaultPrices(), ...defaultFuelCosts(), ...branchPrices[effectiveDate] },
    pricingEffectiveDate: effectiveDate,
  };
}

function syncReportsWithPriceBook(reports = {}, priceBook = {}) {
  return Object.fromEntries(Object.entries(reports).map(([key, report]) => [
    key,
    applyEffectivePricing(report, getEffectivePricing(priceBook, report.branch, report.date, report.shiftId)),
  ]));
}

function buildPumpRows(branch) {
  let counter = 0;
  return (PUMP_LAYOUTS[branch] || PUMP_LAYOUTS.Mabolo).flatMap((nozzles, pumpIndex) =>
    nozzles.map((nozzle) => {
      counter += 1;
      const product = productFromNozzle(nozzle);
      return {
        id: uid(),
        pump: `Pump ${pumpIndex + 1}`,
        nozzle,
        product,
        opening: 0,
        closing: 0,
        closingEntered: false,
        closingEntrySource: "",
      };
    })
  );
}

function validPumpRowKeys(branch) {
  return new Set(buildPumpRows(branch).map((row) => pumpCarryKey(row)));
}

function createReport(branch, date, prices, shiftId = "shift-1", pricingMeta = {}) {
  return {
    id: uid(),
    branch,
    date,
    shiftId,
    confirmed: false,
    confirmedAt: "",
    cashierName: "",
    coverage: shiftById(shiftId).label,
    pricingCoverage: pricingMeta.pricingCoverage || "Daily",
    pricingEffectiveDate: pricingMeta.pricingEffectiveDate || "",
    pricingShiftId: pricingMeta.pricingShiftId || "",
    prices: { ...prices },
    pumpConfigVersion: PUMP_CONFIG_VERSION,
    pumpRows: buildPumpRows(branch),
    tankRows: [
      { id: uid(), tank: "Premium Tank", product: "Premium", opening: 0, delivery: 0, pullOut: 0, calibration: 0, actualDip: 0 },
      { id: uid(), tank: "Regular Tank", product: "Regular", opening: 0, delivery: 0, pullOut: 0, calibration: 0, actualDip: 0 },
      { id: uid(), tank: "Diesel Tank", product: "Diesel", opening: 0, delivery: 0, pullOut: 0, calibration: 0, actualDip: 0 },
    ],
    deductions: {
      gcash: 0,
      card: 0,
      cashRedemption: 0,
      fuelRedemption: 0,
    },
    poRows: [],
    purchaseRows: [],
    oilSales: 0,
    pointsIssued: 0,
    pointsWithdrawn: 0,
    coke: { beginning: 0, ending: 0, redemption: 0 },
    deposits: [],
    midShiftPriceChanges: [],
    actualCashCounted: "",
  };
}

function pumpCarryKey(row) {
  return `${row.pump}|${row.nozzle}|${row.product}`;
}

function tankCarryKey(row) {
  return `${row.tank}|${row.product}`;
}

function openingReadingEntered(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return value !== "" && value !== null && value !== undefined
    && Number.isFinite(Number(value))
    && Number(value) >= 0;
}

function hasCompleteBaselineOpening(report) {
  const pumpRows = report.pumpRows || [];
  const tankRows = report.tankRows || [];
  return pumpRows.length > 0
    && tankRows.length > 0
    && pumpRows.every((row) => openingReadingEntered(row.opening))
    && tankRows.every((row) => openingReadingEntered(row.opening));
}

function baselineConfirmed(report) {
  return report?.baselineConfirmed === true || report?.baseline_confirmed === true;
}

function openingSetupCompleted(report) {
  return Boolean(report?.openingSetupComplete === true || (baselineConfirmed(report) && report?.baselineReport === true));
}

function reportCompleted(report) {
  return Boolean(report?.confirmed || openingSetupCompleted(report));
}

function hasCompletedPumpReadings(report) {
  const pumpRows = report?.pumpRows || [];
  if (!pumpRows.length) return false;
  return pumpRows.every((row) => n(row.opening) > 0 && n(row.closing) >= n(row.opening));
}

function repairAutoApprovedCorrection(report) {
  const request = correctionRequest(report);
  if (!request.autoApproved || report.confirmed || !hasCompletedPumpReadings(report)) return report;
  return {
    ...report,
    confirmed: true,
    confirmedAt: report.confirmedAt || request.approvedAt || report.undoReasonAt || new Date().toLocaleString(),
    undoReason: "",
    undoReasonAt: "",
    correctionRequest: {
      ...request,
      status: "completed",
      autoApproved: false,
      autoApprovalRepaired: true,
      completedAt: request.completedAt || new Date().toLocaleString(),
    },
  };
}

function previousPumpClosing(previousReport, row) {
  if (baselineConfirmed(previousReport) && n(row.closing) <= 0 && n(row.opening) > 0) return n(row.opening);
  return n(row.closing);
}

function previousTankClosing(previousReport, row) {
  if (baselineConfirmed(previousReport) && n(row.actualDip) <= 0 && n(row.opening) > 0) return n(row.opening);
  return n(row.actualDip);
}

function previousCokeEnding(previousReport) {
  if (baselineConfirmed(previousReport) && n(previousReport?.coke?.ending) <= 0 && n(previousReport?.coke?.beginning) > 0) {
    return n(previousReport.coke.beginning);
  }
  return n(previousReport?.coke?.ending);
}

function carryForwardOpenings(report, reports) {
  const previousCarry = findPreviousCarryForwardReport(report, reports);
  const previousReport = previousCarry?.report;

  if (!previousReport) {
    const confirmed = baselineConfirmed(report);
    return {
      ...report,
      baselineConfirmed: confirmed,
      baselineReady: hasCompleteBaselineOpening(report),
      baselineMissing: !confirmed,
      baselineMessage: confirmed ? "" : BASELINE_MESSAGE,
    };
  }

  const previousPumps = Object.fromEntries((previousReport.pumpRows || []).map((row) => [pumpCarryKey(row), row]));
  const previousTanks = Object.fromEntries((previousReport.tankRows || []).map((row) => [tankCarryKey(row), row]));

  return {
    ...report,
    baselineConfirmed: true,
    baselineReady: true,
    baselineMissing: false,
    baselineMessage: "",
    pumpRows: (report.pumpRows || []).map((row) => {
      const previousRow = previousPumps[pumpCarryKey(row)];
      return previousRow
        ? { ...row, opening: previousPumpClosing(previousReport, previousRow), setupRequired: false }
        : { ...row, opening: n(row.opening) > 0 ? row.opening : "", setupRequired: true };
    }),
    tankRows: (report.tankRows || []).map((row) => {
      const previousRow = previousTanks[tankCarryKey(row)];
      return previousRow ? { ...row, opening: previousTankClosing(previousReport, previousRow) } : row;
    }),
    coke: {
      ...(report.coke || {}),
      beginning: previousCokeEnding(previousReport),
    },
  };
}

function findPreviousCarryForwardReport(report, reports) {
  let cursor = previousShiftFor(report.date, report.shiftId || "shift-1");

  for (let checked = 0; checked < 90; checked += 1) {
    const candidate = reports[reportKey(report.branch, cursor.date, cursor.shiftId)];
    if (candidate && reportCompleted(candidate)) {
      return { report: candidate, date: cursor.date, shiftId: cursor.shiftId };
    }

    cursor = previousShiftFor(cursor.date, cursor.shiftId);
  }

  return null;
}

function reportWarnings(report, result) {
  const warnings = [];
  if (report.baselineMissing) warnings.push(report.baselineMessage);

  (report.pumpRows || []).forEach((row) => {
    const opening = n(row.opening);
    const closing = n(row.closing);
    const sold = closing - opening;
    if (opening <= 0 && closing > 0) warnings.push(`${row.pump} ${row.nozzle}: opening is missing, so this reading is not counted yet.`);
    if (sold > 0 && n(report.prices[row.product]) <= 0) warnings.push(`${row.product}: pump price is missing or zero.`);
    if (sold > 10000) warnings.push(`${row.pump} ${row.nozzle}: liters sold is unusually high for one shift.`);
  });

  (report.midShiftPriceChanges || []).forEach((change) => {
    if (!change.effectiveTime) warnings.push(`${change.product}: mid-shift price change is missing the effective time.`);
    if (n(change.newPrice) <= 0) warnings.push(`${change.product}: mid-shift price change is missing the new price.`);
    const matchingRows = (report.pumpRows || []).filter((row) => row.product === change.product);
    const missingReading = matchingRows.some((row) => n(midShiftReadingValue(change, row)) <= 0);
    if (missingReading) warnings.push(`${change.product}: enter the pump reading at the price-change time for every matching nozzle.`);
  });

  (report.tankRows || []).forEach((row) => {
    if (n(row.actualDip) <= 0) warnings.push(`${row.tank}: tank dip reference is missing. Official sales still come from pump readings.`);
  });

  if (n(result.grossSales) > CRITICAL_GROSS_SALES_THRESHOLD) warnings.push("Gross sales is unusually high. Please check opening and closing pump readings.");
  return [...new Set(warnings.filter(Boolean))];
}

function pumpFieldWarnings(report) {
  return blockingPumpReadings(report).map((warning) => ({
    ...warning,
    message: warning.kind === "negative"
      ? `${warning.pump} ${warning.nozzle} (${warning.product}): closing is below opening by ${liter(Math.abs(warning.liters))}. Negative liters are not allowed.`
      : `${warning.pump} ${warning.nozzle} (${warning.product}): ${liter(warning.liters)} is too high or unusual and exceeds the ${liter(MAX_PUMP_LITERS_PER_SHIFT)} maximum for one shift.`,
  }));
}

function activeDeposits(report) {
  return (report.deposits || []).filter((row) => !row.removed);
}

function isRemovalRequested(deposit) {
  return Boolean(deposit.removal_requested || deposit.removalRequested);
}

function depositRequestLabel(deposit) {
  if (!isRemovalRequested(deposit)) return "";
  return deposit.removalRequestType === "change" ? "Change Requested" : "Removal Requested";
}

function depositRequestActionLabel(deposit) {
  return deposit.removalRequestType === "change" ? "Approve Change" : "Approve Removal";
}

function emptyStore() {
  return {
    priceBook: Object.fromEntries(BRANCHES.map((branch) => [branch, {}])),
    reports: {},
  };
}

function readStorageMap(key) {
  try { return JSON.parse(window.localStorage.getItem(key) || "{}") || {}; }
  catch { return {}; }
}

function writeStorageMap(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); }
  catch {
    // The in-memory report remains usable if private storage is unavailable.
  }
}

function readLocalDrafts() {
  return readStorageMap(LOCAL_DRAFTS_KEY);
}

function cacheLocalDraft(report) {
  const drafts = readLocalDrafts();
  drafts[reportKey(report.branch, report.date, report.shiftId)] = report;
  writeStorageMap(LOCAL_DRAFTS_KEY, drafts);
}

function removeLocalDraft(report) {
  const drafts = readLocalDrafts();
  delete drafts[reportKey(report.branch, report.date, report.shiftId)];
  writeStorageMap(LOCAL_DRAFTS_KEY, drafts);
}

function readSavedWizardStep(report, maximumStep) {
  const steps = readStorageMap(LOCAL_WIZARD_STEPS_KEY);
  const saved = Number(steps[reportKey(report.branch, report.date, report.shiftId)]);
  return Number.isInteger(saved) && saved >= 0 && saved <= maximumStep ? saved : 0;
}

function saveWizardStep(report, step) {
  const steps = readStorageMap(LOCAL_WIZARD_STEPS_KEY);
  steps[reportKey(report.branch, report.date, report.shiftId)] = step;
  writeStorageMap(LOCAL_WIZARD_STEPS_KEY, steps);
}

function removeSavedWizardStep(report) {
  const steps = readStorageMap(LOCAL_WIZARD_STEPS_KEY);
  delete steps[reportKey(report.branch, report.date, report.shiftId)];
  writeStorageMap(LOCAL_WIZARD_STEPS_KEY, steps);
}

function draftProgress(report = {}) {
  return {
    pumpClosings: (report.pumpRows || []).filter((row) => row.closingEntered).length,
    tankReadings: (report.tankRows || []).filter((row) => row.actualDip !== "" && row.actualDip !== null && row.actualDip !== undefined).length,
    cashierName: String(report.cashierName || "").trim() ? 1 : 0,
    cashCount: report.actualCashCounted !== "" && report.actualCashCounted !== null && report.actualCashCounted !== undefined ? 1 : 0,
  };
}

function draftProgressTotal(report) {
  return Object.values(draftProgress(report)).reduce((total, value) => total + value, 0);
}

function storeWithLocalDrafts(store = emptyStore(), allowedBranch = "") {
  const reports = { ...store.reports };
  for (const [key, draft] of Object.entries(readLocalDrafts())) {
    if (shouldDiscardOfflineReport(draft, GLOBAL_OPENING_DATE)) {
      removeQueuedReportByKey(key);
      if (draft) removeLocalDraft(draft);
      continue;
    }
    if (reportCompleted(draft) || (allowedBranch && draft.branch !== allowedBranch)) continue;
    const requiredBranchDataVersion = BRANCH_DATA_VERSIONS[draft.branch] || "";
    if (requiredBranchDataVersion && draft.clientSave?.branchDataVersion !== requiredBranchDataVersion) {
      removeLocalDraft(draft);
      removeQueuedReportByKey(key);
      continue;
    }
    const onlineReport = reports[key];
    if (reportCompleted(onlineReport)) {
      removeLocalDraft(draft);
      removeQueuedReportByKey(key);
      continue;
    }
    const onlineVersion = Number(onlineReport?.serverMeta?.version || 0);
    const localBaseVersion = Number(draft.clientSave?.baseVersion ?? draft.serverMeta?.version ?? 0);
    if (onlineReport && onlineVersion > localBaseVersion && draftProgressTotal(draft) <= draftProgressTotal(onlineReport)) {
      removeLocalDraft(draft);
      removeQueuedReportByKey(key);
      continue;
    }
    reports[key] = draft;
  }
  return { ...store, reports };
}

function readCachedCashierSession() {
  try {
    const cached = JSON.parse(window.sessionStorage.getItem(CASHIER_SESSION_CACHE_KEY) || "null");
    if (!cached?.branch || Number(cached.expiresAt || 0) <= Date.now()) return null;
    return cached;
  } catch {
    return null;
  }
}

function cacheCashierSession(branch) {
  try {
    window.sessionStorage.setItem(CASHIER_SESSION_CACHE_KEY, JSON.stringify({ branch, expiresAt: Date.now() + (12 * 60 * 60_000) }));
  } catch {
    // A normal online login still works when session storage is unavailable.
  }
}

function pumpLitersSold(row) {
  const opening = n(row.opening);
  const closing = n(row.closing);
  if (opening <= 0 && closing > 0) return 0;
  return Math.max(0, closing - opening);
}

function pumpVarianceAmount(report, row) {
  const opening = n(row.opening);
  const closing = n(row.closing);
  if (!report.confirmed && opening > 0 && closing === 0) return 0;
  const sold = closing - opening;
  return sold < 0 ? sold : 0;
}

function tankVarianceAmount(report, row, expectedDip) {
  if (!report.confirmed && n(row.actualDip) <= 0) return 0;
  return n(row.actualDip) - expectedDip;
}

function sortedMidShiftChanges(report, product) {
  return (report.midShiftPriceChanges || [])
    .filter((change) => change.product === product)
    .sort((a, b) => midShiftChangeOrder(a, report.shiftId) - midShiftChangeOrder(b, report.shiftId));
}

function validMidShiftChangeForRow(change, row) {
  const reading = n(midShiftReadingValue(change, row));
  return n(change.newPrice) > 0 && reading > n(row.opening) && reading < n(row.closing);
}

function pumpRowSales(report, row) {
  const opening = n(row.opening);
  const closing = n(row.closing);
  if (opening <= 0 || closing <= opening) return 0;

  let currentReading = opening;
  let currentPrice = Math.max(0, n(reportStartingPrice(report, row.product)));
  let sales = 0;

  sortedMidShiftChanges(report, row.product).forEach((change) => {
    if (!validMidShiftChangeForRow(change, row)) return;
    const changeReading = n(midShiftReadingValue(change, row));
    sales += (changeReading - currentReading) * currentPrice;
    currentReading = changeReading;
    currentPrice = Math.max(0, n(change.newPrice));
  });

  sales += (closing - currentReading) * currentPrice;
  return sales;
}

function compute(report) {
  const fuelLiters = { Premium: 0, Regular: 0, Diesel: 0 };
  const fuelSalesByProduct = { Premium: 0, Regular: 0, Diesel: 0 };

  report.pumpRows.forEach((row) => {
    fuelLiters[row.product] += pumpLitersSold(row);
    fuelSalesByProduct[row.product] += pumpRowSales(report, row);
  });

  const calibrationLiters = tankTotalsByProduct(report, "calibration");
  FUEL_TYPES.forEach((product) => {
    const grossLiters = n(fuelLiters[product]);
    const grossSales = n(fuelSalesByProduct[product]);
    const returnedCalibration = Math.min(grossLiters, n(calibrationLiters[product]));
    const averagePrice = grossLiters > 0 ? grossSales / grossLiters : Math.max(0, n(report.prices?.[product]));
    fuelLiters[product] = Math.max(0, grossLiters - returnedCalibration);
    fuelSalesByProduct[product] = Math.max(0, grossSales - returnedCalibration * averagePrice);
  });

  const totalLiters = FUEL_TYPES.reduce((sum, product) => sum + fuelLiters[product], 0);
  const fuelSales = FUEL_TYPES.reduce((sum, product) => sum + fuelSalesByProduct[product], 0);

  const poTotal = report.poRows.reduce((sum, row) => sum + n(row.amount), 0);
  const purchaseTotal = report.purchaseRows.reduce((sum, row) => sum + n(row.amount), 0);
  const pointsIssued = n(report.pointsIssued);
  const pointsWithdrawn = pointsWithdrawnFromRedemptions(report);
  const deductionTotal = countedDeductionEntries(report.deductions).reduce((sum, [, value]) => sum + n(value), 0) + poTotal + purchaseTotal;
  const grossSales = fuelSales + n(report.oilSales);
  const expectedCash = grossSales - deductionTotal;
  const deposits = activeDeposits(report);
  const bankDeposit = deposits.reduce((sum, row) => sum + n(row.amount), 0);
  const confirmedBank = deposits.filter((row) => row.verified).reduce((sum, row) => sum + n(row.amount), 0);
  const pendingBank = Math.max(0, bankDeposit - confirmedBank);
  const pendingCashOnHand = Math.max(0, expectedCash - bankDeposit);
  const actualCashCountEntered = hasActualCashCounted(report);
  const actualCashCounted = actualCashCountEntered ? n(report.actualCashCounted) : 0;
  const cashVariance = physicalCashVariance(actualCashCounted, expectedCash, actualCashCountEntered);
  const depositDifference = depositAllocationDifference(bankDeposit, pendingCashOnHand, expectedCash);
  const actualCashDifference = actualCashCountEntered ? actualCashCounted - pendingCashOnHand : 0;

  const pumpVariance = report.pumpRows.reduce((sum, row) => {
    return sum + pumpVarianceAmount(report, row);
  }, 0);

  const tankRows = report.tankRows.map((row) => {
    const expectedDip = n(row.opening) + n(row.delivery) - fuelLiters[row.product] - n(row.pullOut);
    return { ...row, expectedDip, variance: tankVarianceAmount(report, row, expectedDip) };
  });

  return {
    fuelLiters,
    fuelSalesByProduct,
    totalLiters,
    fuelSales,
    poTotal,
    purchaseTotal,
    pointsIssued,
    pointsWithdrawn,
    deductionTotal,
    grossSales,
    expectedCash,
    bankDeposit,
    confirmedBank,
    pendingBank,
    pendingCashOnHand,
    cashVariance,
    depositDifference,
    actualCashCounted,
    actualCashCountEntered,
    actualCashDifference,
    tankRows,
    pumpVariance,
    tankVariance: tankRows.reduce((sum, row) => sum + row.variance, 0),
    cokeSold: Math.max(0, n(report.coke.beginning) - n(report.coke.ending)),
  };
}

function reportReviewFlags(report, result = compute(report)) {
  if (!report.confirmed) return [];

  const flags = [];
  const hasHighPumpReading = (report.pumpRows || []).some((row) => pumpLitersSold(row) > REVIEW_LITERS_THRESHOLD);
  if (hasHighPumpReading || n(result.totalLiters) > REVIEW_LITERS_THRESHOLD) flags.push("High liters sold");
  const cashVariance = n(result.cashVariance);
  if (cashVariance > REVIEW_CASH_OVERAGE_THRESHOLD || cashVariance < -REVIEW_CASH_VARIANCE_THRESHOLD) {
    flags.push("High cash variance");
  }
  return flags;
}

function isReportNeedsReview(report, result = compute(report)) {
  return reportReviewFlags(report, result).length > 0;
}

function actualCashReconciliationRows(reports = {}) {
  return Object.values(reports)
    .filter((report) => report?.confirmed && hasActualCashCounted(report))
    .map((report) => {
      const result = compute(report);
      const difference = n(result.cashVariance);
      return {
        key: reportKey(report.branch, report.date, report.shiftId),
        branch: report.branch,
        date: report.date,
        shiftId: report.shiftId,
        cashierName: String(report.cashierName || "").trim() || "Not entered",
        expectedCash: n(result.expectedCash),
        physicalCashCounted: n(result.actualCashCounted),
        difference,
        status: difference <= -CASH_SHORTAGE_ALERT_THRESHOLD ? "Shortage" : difference > 0.009 ? "Overage" : "Within Limit",
      };
    })
    .sort((a, b) => `${b.date}|${b.shiftId}|${b.branch}`.localeCompare(`${a.date}|${a.shiftId}|${a.branch}`));
}

function criticalReportWarnings(report, result = compute(report)) {
  const warnings = [];
  const hugeLiters = (report.pumpRows || []).some((row) => pumpLitersSold(row) > CRITICAL_LITERS_THRESHOLD);
  if (hugeLiters || n(result.grossSales) > CRITICAL_GROSS_SALES_THRESHOLD) {
    warnings.push("Do not submit. Opening or closing reading may be wrong.");
  }
  return warnings;
}

function cashVarianceCauseHints(report, result = compute(report)) {
  const hints = [];
  const pumpRows = [...(report.pumpRows || [])]
    .map((row) => ({ row, liters: pumpLitersSold(row) }))
    .filter(({ liters }) => liters > 0)
    .sort((a, b) => b.liters - a.liters);

  const highPumpRows = pumpRows.filter(({ liters }) => liters > REVIEW_LITERS_THRESHOLD);
  highPumpRows.slice(0, 3).forEach(({ row }) => {
    hints.push(`${row.pump} ${row.nozzle} ${row.product}: unusually high pump input. Check opening and closing readings.`);
  });

  (report.midShiftPriceChanges || []).forEach((change) => {
    const matchingRows = (report.pumpRows || []).filter((row) => row.product === change.product);
    const missingReading = matchingRows.some((row) => n(midShiftReadingValue(change, row)) <= 0);
    if (missingReading) {
      hints.push(`${change.product} price-change readings: some pump readings are missing or incomplete.`);
    }
  });

  const fuelTechPay = fuelTechPayTotal(report.deductions);
  if (fuelTechPay > ENTRY_REVIEW_HINT_THRESHOLD) {
    hints.push("FuelTech Pay total: check the FuelTech Pay entry.");
  }

  visibleDeductionEntries(report.deductions || {}).forEach(([key, value]) => {
    if (n(value) > ENTRY_REVIEW_HINT_THRESHOLD) {
      hints.push(`${deductionLabel(key)}: check if this deduction entry was typed correctly.`);
    }
  });

  if (n(report.oilSales) > ENTRY_REVIEW_HINT_THRESHOLD) {
    hints.push("Oil sales: check if the oil sales entry was typed correctly.");
  }

  if (n(report.coke?.ending) > n(report.coke?.beginning)) {
    hints.push("Coke inventory: ending is higher than beginning.");
  }

  if (!hints.length && pumpRows[0]) {
    const { row } = pumpRows[0];
    hints.push(`${row.pump} ${row.nozzle} ${row.product}: highest pump input this shift. Check opening and closing readings first.`);
  }

  if (!hints.length) {
    hints.push("Check pump readings, FuelTech Pay, deductions, oil/coke entries, and deposit coverage before submitting.");
  }

  return [...new Set(hints)].slice(0, 4);
}

function rangeDates(startDate, range) {
  const start = new Date(`${startDate}T00:00:00`);
  if (!startDate || Number.isNaN(start.getTime())) return [];
  const days = range === "1 Day" ? 1 : range === "1 Week" ? 7 : range === "1 Month" ? 30 : range === "2 Months" ? 60 : 90;
  return Array.from({ length: days }, (_, index) => dateOffset(startDate, index));
}

function datesBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (!startDate || !endDate || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(localDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function rankingRangeLabel(range) {
  return range === "All-time" ? "All submitted reports" : range;
}

function rankingReportsForRange(reports = {}, range = "Weekly") {
  const allReports = Object.values(reports).filter((report) => report?.confirmed);
  if (range === "All-time") return allReports;

  const days = range === "Daily" ? 1
    : range === "Weekly" ? 7
      : range === "Monthly" ? 30
        : range === "Quarterly" ? 90
          : range === "Yearly" ? 365
            : 7;
  const startDate = dateOffset(TODAY, -(days - 1));
  return allReports.filter((report) => report.date >= startDate && report.date <= TODAY);
}

function summarizeReports(reports) {
  return reports.reduce((sum, report) => {
    const result = compute(report);
    FUEL_TYPES.forEach((product) => {
      sum.fuelLiters[product] += result.fuelLiters[product];
    });
    sum.totalLiters += result.totalLiters;
    sum.fuelSales += result.fuelSales;
    sum.oilSales += n(report.oilSales);
    sum.grossSales += result.grossSales;
    sum.deductions += result.deductionTotal;
    sum.fuelTechPayTotal += fuelTechPayTotal(report.deductions);
    sum.expectedCash += result.expectedCash;
    sum.bankDeposit += result.bankDeposit;
    sum.confirmedBank += result.confirmedBank;
    sum.pendingBank += result.pendingBank;
    sum.pendingCashOnHand += result.pendingCashOnHand;
    if (result.actualCashCountEntered) {
      sum.actualCashCounted += result.actualCashCounted;
      sum.actualCashDifference += result.actualCashDifference;
      sum.expectedCashForCountedReports += result.expectedCash;
      sum.cashVariance += physicalCashVariance(result.actualCashCounted, result.expectedCash);
      sum.actualCashCountedReports += 1;
    }
    sum.pumpVariance += result.pumpVariance;
    sum.poTotal += result.poTotal;
    sum.purchaseTotal += result.purchaseTotal;
    (report.purchaseRows || []).forEach((row) => {
      const category = CASH_VOUCHER_CATEGORIES.find((item) => item.toLowerCase() === String(row.category || "").trim().toLowerCase());
      if (category) sum.cashVoucherCategories[category] += n(row.amount);
    });
    sum.pointsIssued += result.pointsIssued;
    sum.pointsWithdrawn += result.pointsWithdrawn;
    sum.tankVariance += result.tankVariance;
    sum.cokeSold += result.cokeSold;
    if (isReportNeedsReview(report, result)) sum.needsReviewCount += 1;
    return sum;
  }, {
    fuelLiters: { Premium: 0, Regular: 0, Diesel: 0 },
    totalLiters: 0,
    fuelSales: 0,
    oilSales: 0,
    grossSales: 0,
    deductions: 0,
    fuelTechPayTotal: 0,
    expectedCash: 0,
    bankDeposit: 0,
    confirmedBank: 0,
    pendingBank: 0,
    pendingCashOnHand: 0,
    cashVariance: 0,
    actualCashCounted: 0,
    actualCashDifference: 0,
    expectedCashForCountedReports: 0,
    actualCashCountedReports: 0,
    pumpVariance: 0,
    poTotal: 0,
    purchaseTotal: 0,
    cashVoucherCategories: { OPEX: 0, Personal: 0, Construction: 0 },
    pointsIssued: 0,
    pointsWithdrawn: 0,
    tankVariance: 0,
    cokeSold: 0,
    needsReviewCount: 0,
  });
}

function fuelMarginForReports(reports, priceBook) {
  return reports.reduce((total, report) => {
    const prices = ownerPricesForBranch(priceBook, report.branch, report.date, report.shiftId);
    const result = compute(report);
    return total + FUEL_TYPES.reduce((sum, product) => {
      const margin = n(prices[product]) - fuelCostForProduct(prices, product);
      return sum + (margin > 0 ? result.fuelLiters[product] * margin : 0);
    }, 0);
  }, 0);
}

function reportsForDate(reports, date) {
  const keys = [];
  BRANCHES.forEach((branch) => {
    SHIFT_OPTIONS.forEach((shift) => keys.push(reportKey(branch, date, shift.id)));
  });
  return keys.map((key) => reports[key]).filter(Boolean);
}

function confirmedReportsBetween(reports, startDate, endDate) {
  return datesBetween(startDate, endDate).flatMap((date) =>
    BRANCHES.flatMap((branch) =>
      SHIFT_OPTIONS.map((shift) => reports[reportKey(branch, date, shift.id)]).filter((report) => report?.confirmed)
    )
  );
}

function hasMeaningfulDraftEntries(report) {
  if (!report) return false;
  if (String(report.cashierName || "").trim()) return true;
  if ((report.pumpRows || []).some((row) => row.closingEntered || row.closingEntrySource === "cashier")) return true;
  if ((report.tankRows || []).some((row) => [row.delivery, row.pullOut, row.calibration, row.actualDip].some((value) => n(value) !== 0))) return true;
  if (Object.values(report.deductions || {}).some((value) => n(value) !== 0)) return true;
  if ((report.poRows || []).length > 0 || (report.purchaseRows || []).length > 0) return true;
  return report.actualCashCounted !== "" && report.actualCashCounted !== undefined && report.actualCashCounted !== null;
}

function stationShiftHealth(report, branch, date, shiftId) {
  if (isMaboloPreOpeningSlot(branch, date, shiftId)) return { label: "Not Required", tone: "green" };
  if (!report) return { label: "Missing", tone: "red" };
  if (openingSetupCompleted(report)) return { label: "Submitted", tone: "green", detail: "Opening Setup" };
  if (!report.confirmed && !hasMeaningfulDraftEntries(report)) return { label: "Missing", tone: "red" };
  if (!report.confirmed) return { label: "Draft", tone: "yellow" };
  const result = compute(report);
  if (isReportNeedsReview(report, result)) return { label: "Check Required", tone: "yellow" };
  return { label: "Submitted", tone: "green" };
}

function stationHealthRows(reports, date) {
  return BRANCHES.map((branch) => ({
    branch,
    shifts: SHIFT_OPTIONS.map((shift) => ({
      shift,
      status: stationShiftHealth(reports[reportKey(branch, date, shift.id)], branch, date, shift.id),
    })),
  }));
}

function stationHealthRangeRows(reports, startDate, endDate) {
  return datesBetween(startDate, endDate).flatMap((date) =>
    BRANCHES.map((branch) => ({
      date,
      branch,
      shifts: SHIFT_OPTIONS.map((shift) => ({
        shift,
        status: stationShiftHealth(reports[reportKey(branch, date, shift.id)], branch, date, shift.id),
      })),
    }))
  );
}

function stationHealthCounts(rows) {
  return rows.reduce((counts, row) => {
    row.shifts.forEach(({ status }) => {
      counts[status.label] = n(counts[status.label]) + 1;
    });
    return counts;
  }, {});
}

function depositHealthStatus(report, branch, date, shiftId) {
  if (isMaboloPreOpeningSlot(branch, date, shiftId)) return { label: "Not Required", tone: "green" };
  if (!report) return { label: "No Report", tone: "red" };
  if (openingSetupCompleted(report)) return { label: "Not Required", tone: "green" };
  if (!report.confirmed) return { label: "Draft", tone: "yellow" };
  const deposits = activeDeposits(report);
  if (deposits.length === 0) return { label: "Deposit Missing", tone: "red" };
  if (deposits.some((deposit) => !deposit.verified)) return { label: "Deposit Pending", tone: "yellow" };
  return { label: "Deposit Saved", tone: "green" };
}

function depositHealthRows(reports, startDate, endDate) {
  return datesBetween(startDate, endDate).flatMap((date) =>
    BRANCHES.map((branch) => ({
      date,
      branch,
      shifts: SHIFT_OPTIONS.map((shift) => ({
        shift,
        status: depositHealthStatus(reports[reportKey(branch, date, shift.id)], branch, date, shift.id),
      })),
    }))
  );
}

function statusCounts(rows) {
  return rows.reduce((counts, row) => {
    row.shifts.forEach(({ status }) => {
      counts[status.label] = n(counts[status.label]) + 1;
    });
    return counts;
  }, {});
}

function priceChangeHistoryRows(reports = {}, priceBook = {}) {
  const dailyRows = Object.entries(priceBook || {}).flatMap(([branch, branchPrices]) =>
    Object.entries(branchPrices || {}).map(([key, prices]) => ({
      key: `price-${branch}-${key}`,
      date: String(key).split("__")[0],
      branch,
      shift: key.includes("__") ? shortShiftLabel(String(key).split("__")[1]) : "Daily",
      product: "All Products",
      value: FUEL_TYPES.map((product) => `${product}: ${peso(prices?.[product])}`).join(" | "),
      source: "Manager price",
    }))
  );
  const midShiftRows = Object.values(reports || {}).flatMap((report) =>
    (report.midShiftPriceChanges || []).map((change) => ({
      key: `mid-${report.branch}-${report.date}-${report.shiftId}-${change.id}`,
      date: report.date,
      branch: report.branch,
      shift: shortShiftLabel(shiftIdForEffectiveTime(change.effectiveTime) || report.shiftId),
      product: change.product,
      value: `${change.effectiveTime || "No time"} | ${peso(change.newPrice)}`,
      source: "Mid-shift change",
    }))
  );
  return [...dailyRows, ...midShiftRows]
    .filter((row) => row.date)
    .sort((a, b) => `${b.date}|${b.branch}|${b.shift}|${b.source}`.localeCompare(`${a.date}|${a.branch}|${a.shift}|${a.source}`));
}

function groupedDepositRows(rows = []) {
  const groups = new Map();
  rows.forEach((item) => {
    const deposit = item.deposit || {};
    const key = deposit.groupId || `${item.report?.branch}-${item.report?.date}-${item.report?.shiftId}-${deposit.id}`;
    const group = groups.get(key) || { ...item, items: [], shifts: [], amount: 0 };
    group.items.push(item);
    group.shifts.push(item.report?.shiftId);
    group.amount += n(deposit.amount);
    group.deposit = {
      ...deposit,
      amount: n(deposit.totalDepositAmount) || group.amount,
      verified: group.items.every(({ deposit: rowDeposit }) => rowDeposit.verified),
      removalRequested: group.items.some(({ deposit: rowDeposit }) => isRemovalRequested(rowDeposit)),
      removal_requested: group.items.some(({ deposit: rowDeposit }) => isRemovalRequested(rowDeposit)),
      removalRequestType: group.items.find(({ deposit: rowDeposit }) => isRemovalRequested(rowDeposit))?.deposit?.removalRequestType || "",
    };
    groups.set(key, group);
  });
  return Array.from(groups.values());
}

function stationRankingRows(reports) {
  const rowsByBranch = Object.fromEntries(BRANCHES.map((branch) => [branch, {
    branch,
    submitted: 0,
    litersSold: 0,
    expectedCash: 0,
    deductions: 0,
  }]));

  reports.filter((report) => report?.confirmed).forEach((report) => {
    const row = rowsByBranch[report.branch];
    if (!row) return;
    const result = compute(report);
    row.submitted += 1;
    row.litersSold += result.totalLiters;
    row.expectedCash += result.expectedCash;
    row.deductions += result.deductionTotal;
  });

  return Object.values(rowsByBranch)
    .map((row) => ({
      ...row,
      score: row.litersSold,
    }))
    .sort((a, b) => b.score - a.score);
}

function cashFlowLabel(value) {
  if (n(value) < 0) return "Negative";
  if (n(value) > 0) return "Positive";
  return "Balanced";
}

function mobileAdminInsights(reports) {
  const shiftSales = Object.fromEntries(SHIFT_OPTIONS.map((shift) => [shift.id, 0]));
  const productSalesTotals = defaultPrices();
  const stationSales = Object.fromEntries(BRANCHES.map((branch) => [branch, 0]));
  const dailySales = {};

  reports.filter((report) => report?.confirmed).forEach((report) => {
    const result = compute(report);
    shiftSales[report.shiftId] = n(shiftSales[report.shiftId]) + result.grossSales;
    FUEL_TYPES.forEach((product) => {
      productSalesTotals[product] += n(result.fuelSalesByProduct?.[product]);
    });
    stationSales[report.branch] = n(stationSales[report.branch]) + result.grossSales;
    dailySales[report.date] = n(dailySales[report.date]) + result.grossSales;
  });

  return {
    dailySales: Object.entries(dailySales)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ label: date.slice(5), value })),
    shiftSales: SHIFT_OPTIONS.map((shift) => ({
      label: shift.label.split(" - ")[0],
      value: shiftSales[shift.id],
    })),
    productSales: FUEL_TYPES.map((product) => ({
      label: product,
      value: productSalesTotals[product],
    })),
    stationSales: BRANCHES.map((branch) => ({
      label: branch,
      value: stationSales[branch],
    })).sort((a, b) => b.value - a.value),
  };
}

function humanizeKey(key) {
  return String(key).replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function excelCell(value = "", style = "Cell", mergeAcross = 0) {
  const attrs = [`ss:StyleID="${style}"`];
  if (mergeAcross) attrs.push(`ss:MergeAcross="${mergeAcross}"`);
  if (value === null || value === undefined || value === "") return `<Cell ${attrs.join(" ")} />`;
  const isNumber = typeof value === "number" && Number.isFinite(value);
  return `<Cell ${attrs.join(" ")}><Data ss:Type="${isNumber ? "Number" : "String"}">${escapeXml(isNumber ? Number(value.toFixed(2)) : value)}</Data></Cell>`;
}

function excelRow(cells, height = 19) {
  return `<Row ss:Height="${height}">${cells.join("")}</Row>`;
}

function excelWorksheet(name, columns, rows) {
  const columnXml = columns.map((width) => `<Column ss:AutoFitWidth="0" ss:Width="${width}" />`).join("");
  return `<Worksheet ss:Name="${escapeXml(name.slice(0, 31))}">
    <Table>${columnXml}${rows.join("")}</Table>
  </Worksheet>`;
}

function downloadExcelFile(filename, xml) {
  const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function productSales(report, result, product) {
  return n(result.fuelSalesByProduct?.[product]);
}

function shortShiftLabel(shiftId) {
  return shiftById(shiftId).label.replace(/^Shift \d - /, "");
}

function sortedExportReports(reports) {
  return [...reports].sort((a, b) =>
    `${a.branch}|${a.date}|${a.shiftId}`.localeCompare(`${b.branch}|${b.date}|${b.shiftId}`)
  );
}

function pumpProductLiters(report) {
  return (report.pumpRows || []).reduce((totals, row) => {
    totals[row.pump] = totals[row.pump] || defaultPrices();
    totals[row.pump][row.product] = n(totals[row.pump][row.product]) + pumpLitersSold(row);
    return totals;
  }, {});
}

function tankTotalsByProduct(report, key) {
  return (report.tankRows || []).reduce((totals, row) => {
    totals[row.product] = n(totals[row.product]) + n(row[key]);
    return totals;
  }, defaultPrices());
}

function deliveryLitersByProductForBranchDate(reports, branch, date) {
  return SHIFT_OPTIONS.reduce((totals, shift) => {
    const report = reports[reportKey(branch, date, shift.id)];
    (report?.tankRows || []).forEach((row) => {
      totals[row.product] = n(totals[row.product]) + n(row.delivery);
    });
    return totals;
  }, defaultPrices());
}

function fuelDeliveryCostRows(reports = {}, priceBook = {}) {
  return Object.values(reports || {})
    .filter((report) => report?.confirmed)
    .map((report) => {
      const deliveryLiters = (report.tankRows || []).reduce((totals, row) => {
        totals[row.product] = n(totals[row.product]) + n(row.delivery);
        return totals;
      }, defaultPrices());
      const totalLiters = FUEL_TYPES.reduce((sum, product) => sum + n(deliveryLiters[product]), 0);
      if (totalLiters <= 0) return null;

      const prices = getEffectiveDailyPricing(priceBook, report.branch, report.date).prices;
      const key = reportKey(report.branch, report.date, report.shiftId);
      const meta = prices.fuelDeliveryCostMeta || {};
      const confirmed = Boolean(meta.confirmedDeliveries?.[key])
        || (meta.station === report.branch && meta.dateDelivered === report.date && meta.shiftDelivered === report.shiftId);
      const missingCosts = FUEL_TYPES.filter((product) => n(deliveryLiters[product]) > 0 && fuelCostForProduct(prices, product) <= 0);

      return {
        key,
        branch: report.branch,
        date: report.date,
        shiftId: report.shiftId,
        deliveryLiters,
        totalLiters,
        prices,
        confirmed,
        missingCosts,
      };
    })
    .filter(Boolean)
    .sort((a, b) => `${b.date}|${b.shiftId}|${b.branch}`.localeCompare(`${a.date}|${a.shiftId}|${a.branch}`));
}

function resultTankVarianceByProduct(result) {
  return (result.tankRows || []).reduce((totals, row) => {
    totals[row.product] = n(totals[row.product]) + n(row.variance);
    return totals;
  }, defaultPrices());
}

function sumReportsBy(reports, groupKey) {
  return reports.reduce((groups, report) => {
    const key = groupKey(report);
    groups[key] = groups[key] || [];
    groups[key].push(report);
    return groups;
  }, {});
}

function reportStatusText(report) {
  return report.confirmed ? "SUBMITTED" : "DRAFT";
}

function depositStatusText(deposit) {
  if (deposit.removed) return "REMOVED";
  if (isRemovalRequested(deposit)) return "REMOVAL REQUESTED";
  return deposit.verified ? "VERIFIED" : "PENDING";
}

function reportSourceLabel(report) {
  return `${report.branch} | ${report.date} | ${shortShiftLabel(report.shiftId)}`;
}

function sheetTitle(title, columns) {
  return excelRow([excelCell(title, "Title", columns - 1)], 24);
}

function totalRow(label, values, columns) {
  const cells = [excelCell(label, "Total", 2), ...values.map((value) => excelCell(value, typeof value === "number" && value < 0 ? "RedValue" : "Total"))];
  while (cells.length < columns) cells.push(excelCell("", "Total"));
  return excelRow(cells);
}

function baseWorkbookXml(worksheets) {
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Cell"><Alignment ss:Horizontal="Center" ss:Vertical="Center" /><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" /></Borders><NumberFormat ss:Format="#,##0.00;[Red](#,##0.00)" /></Style>
    <Style ss:ID="Text"><Alignment ss:Horizontal="Center" ss:Vertical="Center" /><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" /></Borders><NumberFormat ss:Format="@" /></Style>
    <Style ss:ID="Title"><Alignment ss:Horizontal="Center" ss:Vertical="Center" /><Font ss:Bold="1" ss:Size="14" ss:Color="#000000" /><Interior ss:Color="#7F7F7F" ss:Pattern="Solid" /><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" /></Borders></Style>
    <Style ss:ID="Header"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1" /><Font ss:Bold="1" ss:Color="#000000" /><Interior ss:Color="#FFFF00" ss:Pattern="Solid" /><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" /></Borders></Style>
    <Style ss:ID="SubHeader"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1" /><Font ss:Bold="1" ss:Color="#000000" /><Interior ss:Color="#BFBFBF" ss:Pattern="Solid" /><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" /></Borders></Style>
    <Style ss:ID="Total"><Alignment ss:Horizontal="Center" ss:Vertical="Center" /><Font ss:Bold="1" ss:Color="#000000" /><Interior ss:Color="#FFFF00" ss:Pattern="Solid" /><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" /></Borders><NumberFormat ss:Format="#,##0.00;[Red](#,##0.00)" /></Style>
    <Style ss:ID="RedValue"><Alignment ss:Horizontal="Center" ss:Vertical="Center" /><Font ss:Bold="1" ss:Color="#FFFFFF" /><Interior ss:Color="#FF0000" ss:Pattern="Solid" /><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" /><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" /></Borders><NumberFormat ss:Format="#,##0.00;[Red](#,##0.00)" /></Style>
  </Styles>
  ${worksheets.join("")}
</Workbook>`;
}

function exportDetailedReportsToExcel(reports, summary, startDate, endDate) {
  const exportReports = sortedExportReports(reports);
  const generatedAt = new Date().toLocaleString("en-PH");
  const pumps = Array.from(new Set(exportReports.flatMap((report) => (report.pumpRows || []).map((row) => row.pump))))
    .sort((a, b) => n(a.replace(/\D/g, "")) - n(b.replace(/\D/g, "")) || a.localeCompare(b));
  const baseColumns = [92, 74, 96];
  const productColumns = [72, 72, 72];

  const summaryRows = [
    sheetTitle("FUELTECH ACCOUNTING EXPORT", 5),
    excelRow([excelCell("Generated At", "Header"), excelCell(generatedAt), excelCell("Start Date", "Header"), excelCell(startDate), excelCell("End Date", "Header")]),
    excelRow([excelCell("Reports Included", "Header"), excelCell(exportReports.length), excelCell("Scope", "Header"), excelCell("All Stations", "Cell", 1)]),
    excelRow([excelCell("Metric", "SubHeader"), excelCell("Value", "SubHeader"), excelCell("Metric", "SubHeader"), excelCell("Value", "SubHeader"), excelCell("Notes", "SubHeader")]),
    excelRow([excelCell("Fuel Sales PHP", "Header"), excelCell(summary.fuelSales), excelCell("Oil Sales PHP", "Header"), excelCell(summary.oilSales), excelCell("")]),
    excelRow([excelCell("Gross Sales PHP", "Header"), excelCell(summary.grossSales), excelCell("Expected Cash PHP", "Header"), excelCell(summary.expectedCash), excelCell("")]),
    excelRow([excelCell("Bank Deposit PHP", "Header"), excelCell(summary.bankDeposit), excelCell("Pending Cash On Hand PHP", "Header"), excelCell(summary.pendingCashOnHand), excelCell("Undeposited cash waiting for bank deposit")]),
    excelRow([excelCell("Actual Cash Counted PHP", "Header"), excelCell(summary.actualCashCounted), excelCell("Actual Cash Difference PHP", summary.actualCashDifference < 0 ? "RedValue" : "Header"), excelCell(summary.actualCashDifference, summary.actualCashDifference < 0 ? "RedValue" : "Cell"), excelCell(`${summary.actualCashCountedReports} report(s) counted`)]),
    excelRow([excelCell("Cash Variance PHP", summary.cashVariance < 0 ? "RedValue" : "Header"), excelCell(summary.cashVariance, summary.cashVariance < 0 ? "RedValue" : "Cell"), excelCell("Physical cash counted minus expected cash; deposits excluded"), excelCell(""), excelCell("")]),
    excelRow([excelCell("Premium Liters", "Header"), excelCell(summary.fuelLiters.Premium), excelCell("Regular Liters", "Header"), excelCell(summary.fuelLiters.Regular), excelCell("")]),
    excelRow([excelCell("Diesel Liters", "Header"), excelCell(summary.fuelLiters.Diesel), excelCell("Total Liters", "Header"), excelCell(summary.totalLiters), excelCell("")]),
  ];

  const pumpHeaderTop = [
    excelCell("BRANCH", "Header"),
    excelCell("DATE", "Header"),
    excelCell("SHIFT", "Header"),
    excelCell("TOTAL SALES", "Header", 2),
    ...pumps.map((pump) => excelCell(pump.toUpperCase(), "Header", 2)),
  ];
  const pumpHeaderSecond = [
    excelCell("", "SubHeader"),
    excelCell("", "SubHeader"),
    excelCell("", "SubHeader"),
    ...FUEL_TYPES.map((product) => excelCell(product.toUpperCase().slice(0, 4), "SubHeader")),
    ...pumps.flatMap(() => FUEL_TYPES.map((product) => excelCell(product.toUpperCase().slice(0, 4), "SubHeader"))),
  ];
  const pumpRows = [
    sheetTitle("DAILY PUMP READING", 3 + 3 + pumps.length * 3),
    excelRow(pumpHeaderTop),
    excelRow(pumpHeaderSecond),
    totalRow("TOTAL", [
      summary.fuelLiters.Premium,
      summary.fuelLiters.Regular,
      summary.fuelLiters.Diesel,
      ...pumps.flatMap((pump) => FUEL_TYPES.map((product) =>
        exportReports.reduce((sum, report) => sum + n(pumpProductLiters(report)[pump]?.[product]), 0)
      )),
    ], 3 + 3 + pumps.length * 3),
    ...exportReports.map((report) => {
      const result = compute(report);
      const pumpLiters = pumpProductLiters(report);
      return excelRow([
        excelCell(report.branch, "Text"),
        excelCell(report.date, "Text"),
        excelCell(shortShiftLabel(report.shiftId), "Text"),
        ...FUEL_TYPES.map((product) => excelCell(result.fuelLiters[product])),
        ...pumps.flatMap((pump) => FUEL_TYPES.map((product) => excelCell(n(pumpLiters[pump]?.[product])))),
      ]);
    }),
  ];

  const cashRows = [
    sheetTitle("DAILY STATION CASH VARIANCE", 18),
    excelRow([
      excelCell("BRANCH", "Header"),
      excelCell("DATE", "Header"),
      excelCell("SHIFT", "Header"),
      excelCell("TOTAL SALES", "Header", 3),
      excelCell("TOTAL PRODUCT SALES IN LITERS", "Header", 3),
      excelCell("PRICE PER PRODUCT", "Header", 2),
      excelCell("CASH CHECK", "Header", 5),
    ]),
    excelRow([
      excelCell("", "SubHeader"), excelCell("", "SubHeader"), excelCell("", "SubHeader"),
      excelCell("PREM", "SubHeader"), excelCell("REG", "SubHeader"), excelCell("DSL", "SubHeader"), excelCell("TOTAL SALES IN PESO", "SubHeader"),
      excelCell("PREM", "SubHeader"), excelCell("REG", "SubHeader"), excelCell("DSL", "SubHeader"),
      excelCell("PREM", "SubHeader"), excelCell("REG", "SubHeader"), excelCell("DSL", "SubHeader"),
      excelCell("EXPECTED CASH", "SubHeader"), excelCell("BANK", "SubHeader"), excelCell("PENDING CASH", "SubHeader"), excelCell("ACTUAL CASH COUNTED", "SubHeader"), excelCell("ACTUAL CASH DIFFERENCE", "SubHeader"),
    ]),
    totalRow("TOTAL", [
      exportReports.reduce((sum, report) => sum + productSales(report, compute(report), "Premium"), 0),
      exportReports.reduce((sum, report) => sum + productSales(report, compute(report), "Regular"), 0),
      exportReports.reduce((sum, report) => sum + productSales(report, compute(report), "Diesel"), 0),
      summary.fuelSales,
      summary.fuelLiters.Premium,
      summary.fuelLiters.Regular,
      summary.fuelLiters.Diesel,
      "", "", "",
      summary.expectedCash,
      summary.bankDeposit,
      summary.pendingCashOnHand,
      summary.actualCashCounted,
      summary.actualCashDifference,
    ], 18),
    ...exportReports.map((report) => {
      const result = compute(report);
      return excelRow([
        excelCell(report.branch, "Text"), excelCell(report.date, "Text"), excelCell(shortShiftLabel(report.shiftId), "Text"),
        ...FUEL_TYPES.map((product) => excelCell(productSales(report, result, product))),
        excelCell(result.fuelSales),
        ...FUEL_TYPES.map((product) => excelCell(result.fuelLiters[product])),
        ...FUEL_TYPES.map((product) => excelCell(n(report.prices?.[product]))),
        excelCell(result.expectedCash),
        excelCell(result.bankDeposit),
        excelCell(result.pendingCashOnHand),
        excelCell(result.actualCashCountEntered ? result.actualCashCounted : "", result.actualCashCountEntered ? "Cell" : "Text"),
        excelCell(result.actualCashCountEntered ? result.actualCashDifference : "", result.actualCashDifference < 0 ? "RedValue" : "Cell"),
      ]);
    }),
  ];

  const deductionsRows = [
    sheetTitle("DAILY DEDUCTIONS", 13),
    excelRow([excelCell("BRANCH", "Header"), excelCell("DATE", "Header"), excelCell("SHIFT", "Header"), excelCell("TOTAL DEDUCTIONS", "Header", 9)]),
    excelRow([
      excelCell("", "SubHeader"), excelCell("", "SubHeader"), excelCell("", "SubHeader"),
      ...["FUELTECH PAY TOTAL", "PO", "CASH VOUCHER", "CASH REDEEM", "FUEL REDEEM", "COKE RELEASE", "POINTS ISSUED", "POINTS WITHDRAWN"].map((label) => excelCell(label, "SubHeader")),
    ]),
    totalRow("TOTAL", [
      summary.fuelTechPayTotal,
      summary.poTotal,
      summary.purchaseTotal,
      exportReports.reduce((sum, report) => sum + n(report.deductions?.cashRedemption), 0),
      exportReports.reduce((sum, report) => sum + n(report.deductions?.fuelRedemption), 0),
      summary.cokeSold,
      summary.pointsIssued,
      summary.pointsWithdrawn,
    ], 13),
    ...exportReports.map((report) => {
      const result = compute(report);
      return excelRow([
        excelCell(report.branch, "Text"), excelCell(report.date, "Text"), excelCell(shortShiftLabel(report.shiftId), "Text"),
        excelCell(fuelTechPayTotal(report.deductions)),
        excelCell(result.poTotal), excelCell(result.purchaseTotal),
        excelCell(n(report.deductions?.cashRedemption)), excelCell(n(report.deductions?.fuelRedemption)), excelCell(result.cokeSold),
        excelCell(result.pointsIssued), excelCell(result.pointsWithdrawn),
      ]);
    }),
  ];

  const ugtRows = [
    sheetTitle("Underground Tank", 16),
    excelRow([
      excelCell("BRANCH", "Header"), excelCell("DATE", "Header"), excelCell("SHIFT", "Header"),
      excelCell("UNDERGROUND TANK DIFFERENCE", "Header", 2), excelCell("OFFICIAL PUMP LITERS SOLD", "Header", 3), excelCell("UNDERGROUND TANK ENDING DIP", "Header", 2), excelCell("DELIVERY", "Header", 2),
    ]),
    excelRow([
      excelCell("", "SubHeader"), excelCell("", "SubHeader"), excelCell("", "SubHeader"),
      ...FUEL_TYPES.map((product) => excelCell(product.toUpperCase().slice(0, 4), "SubHeader")),
      ...FUEL_TYPES.map((product) => excelCell(product.toUpperCase().slice(0, 4), "SubHeader")),
      excelCell("TOTAL", "SubHeader"),
      ...FUEL_TYPES.map((product) => excelCell(product.toUpperCase().slice(0, 4), "SubHeader")),
      ...FUEL_TYPES.map((product) => excelCell(product.toUpperCase().slice(0, 4), "SubHeader")),
    ]),
    totalRow("TOTAL", [
      ...FUEL_TYPES.map((product) => exportReports.reduce((sum, report) => sum + resultTankVarianceByProduct(compute(report))[product], 0)),
      ...FUEL_TYPES.map((product) => summary.fuelLiters[product]),
      summary.totalLiters,
      ...FUEL_TYPES.map((product) => exportReports.reduce((sum, report) => sum + tankTotalsByProduct(report, "actualDip")[product], 0)),
      ...FUEL_TYPES.map((product) => exportReports.reduce((sum, report) => sum + tankTotalsByProduct(report, "delivery")[product], 0)),
    ], 16),
    ...exportReports.map((report) => {
      const result = compute(report);
      const variances = resultTankVarianceByProduct(result);
      const ending = tankTotalsByProduct(report, "actualDip");
      const delivery = tankTotalsByProduct(report, "delivery");
      return excelRow([
        excelCell(report.branch, "Text"), excelCell(report.date, "Text"), excelCell(shortShiftLabel(report.shiftId), "Text"),
        ...FUEL_TYPES.map((product) => excelCell(variances[product], variances[product] < 0 ? "RedValue" : "Cell")),
        ...FUEL_TYPES.map((product) => excelCell(result.fuelLiters[product])),
        excelCell(result.totalLiters),
        ...FUEL_TYPES.map((product) => excelCell(ending[product])),
        ...FUEL_TYPES.map((product) => excelCell(delivery[product])),
      ]);
    }),
  ];

  const systemRows = [
    sheetTitle("SYSTEM REPORT", 16),
    excelRow([
      ...["BRANCH", "DATE", "SHIFT", "TOTAL SALES IN LITERS", "FUEL SALES", "OIL SALES", "GROSS SALES", "TOTAL FUEL REDEMPTION", "TOTAL CASH REDEMPTION", "TOTAL COKE REDEMPTION", "POINTS ISSUED", "POINTS WITHDRAWN", "TOTAL REDEMPTION", "BANK DEPOSIT", "EXPECTED CASH", "SYSTEM VARIANCE"].map((label) => excelCell(label, "Header")),
    ]),
    totalRow("TOTAL", [
      "", "",
      summary.totalLiters,
      summary.fuelSales,
      summary.oilSales,
      summary.grossSales,
      exportReports.reduce((sum, report) => sum + n(report.deductions?.fuelRedemption), 0),
      exportReports.reduce((sum, report) => sum + n(report.deductions?.cashRedemption), 0),
      summary.cokeSold,
      summary.pointsIssued,
      summary.pointsWithdrawn,
      exportReports.reduce((sum, report) => sum + pointsWithdrawnFromRedemptions(report) + compute(report).cokeSold, 0),
      summary.bankDeposit,
      summary.expectedCash,
      summary.cashVariance,
    ], 16),
    ...exportReports.map((report) => {
      const result = compute(report);
      const totalRedemption = n(report.deductions?.fuelRedemption) + n(report.deductions?.cashRedemption) + result.cokeSold;
      return excelRow([
        excelCell(report.branch, "Text"), excelCell(report.date, "Text"), excelCell(shortShiftLabel(report.shiftId), "Text"),
        excelCell(result.totalLiters), excelCell(result.fuelSales), excelCell(n(report.oilSales)), excelCell(result.grossSales),
        excelCell(n(report.deductions?.fuelRedemption)), excelCell(n(report.deductions?.cashRedemption)), excelCell(result.cokeSold),
        excelCell(result.pointsIssued), excelCell(result.pointsWithdrawn),
        excelCell(totalRedemption), excelCell(result.bankDeposit), excelCell(result.expectedCash), excelCell(result.cashVariance, "RedValue"),
      ]);
    }),
  ];

  const detailColumns = [84, 78, 84, 120, 120, 88, 90, 96, 96, 96, 96];
  const detailRows = [
    sheetTitle("BANK DEPOSITS", 11),
    excelRow(["BRANCH", "DATE", "SHIFT", "BANK", "REFERENCE", "AMOUNT", "VERIFIED", "REMOVAL REQUESTED", "REMOVED", "COUNTS IN TOTALS", "CASHIER"].map((label) => excelCell(label, "Header"))),
    ...exportReports.flatMap((report) => (report.deposits || []).map((deposit) => excelRow([
      excelCell(report.branch, "Text"), excelCell(report.date, "Text"), excelCell(shortShiftLabel(report.shiftId), "Text"),
      excelCell(deposit.bank || "", "Text"), excelCell(deposit.reference || "", "Text"), excelCell(n(deposit.amount)),
      excelCell(deposit.verified ? "YES" : "NO", "Text"), excelCell(isRemovalRequested(deposit) ? "YES" : "NO", "Text"),
      excelCell(deposit.removed ? "YES" : "NO", "Text"), excelCell(deposit.removed ? "NO" : "YES", "Text"), excelCell(report.cashierName || "", "Text"),
    ]))),
    sheetTitle("PO ACCOUNTS", 11),
    excelRow(["BRANCH", "DATE", "SHIFT", "ACCOUNT", "AMOUNT", "", "", "", "", "", ""].map((label) => excelCell(label, "Header"))),
    ...exportReports.flatMap((report) => (report.poRows || []).map((row) => excelRow([
      excelCell(report.branch, "Text"), excelCell(report.date, "Text"), excelCell(shortShiftLabel(report.shiftId), "Text"),
      excelCell(row.account || "", "Text"), excelCell(n(row.amount)), excelCell(), excelCell(), excelCell(), excelCell(), excelCell(), excelCell(),
    ]))),
    sheetTitle("CASH VOUCHERS", 11),
    excelRow(["BRANCH", "DATE", "SHIFT", "CATEGORY", "PARTICULAR", "AMOUNT", "", "", "", "", ""].map((label) => excelCell(label, "Header"))),
    ...exportReports.flatMap((report) => (report.purchaseRows || []).map((row) => excelRow([
      excelCell(report.branch, "Text"), excelCell(report.date, "Text"), excelCell(shortShiftLabel(report.shiftId), "Text"),
      excelCell(row.category || "Uncategorized", "Text"), excelCell(row.item || "", "Text"), excelCell(n(row.amount)),
      excelCell(), excelCell(), excelCell(), excelCell(), excelCell(),
    ]))),
  ];

  const branchGroups = sumReportsBy(exportReports, (report) => report.branch);
  const branchRows = [
    sheetTitle("BRANCH TOTAL SUMMARY", 21),
    excelRow(["BRANCH", "REPORTS", "FUEL SALES", "OIL SALES", "GROSS SALES", "DEDUCTIONS", "EXPECTED CASH", "BANK DEPOSIT", "CONFIRMED BANK", "PENDING BANK", "PENDING CASH ON HAND", "ACTUAL CASH COUNTED", "ACTUAL CASH DIFFERENCE", "CASH VARIANCE", "PREM L", "REG L", "DSL L", "TOTAL L", "PO", "CASH VOUCHER", "COKE"].map((label) => excelCell(label, "Header"))),
    totalRow("TOTAL", [
      exportReports.length,
      summary.fuelSales,
      summary.oilSales,
      summary.grossSales,
      summary.deductions,
      summary.expectedCash,
      summary.bankDeposit,
      summary.confirmedBank,
      summary.pendingBank,
      summary.pendingCashOnHand,
      summary.actualCashCounted,
      summary.actualCashDifference,
      summary.cashVariance,
      summary.fuelLiters.Premium,
      summary.fuelLiters.Regular,
      summary.fuelLiters.Diesel,
      summary.totalLiters,
      summary.poTotal,
      summary.purchaseTotal,
      summary.cokeSold,
    ], 21),
    ...BRANCHES.map((branchName) => {
      const branchReports = branchGroups[branchName] || [];
      const branchSummary = summarizeReports(branchReports);
      return excelRow([
        excelCell(branchName, "Text"),
        excelCell(branchReports.length),
        excelCell(branchSummary.fuelSales),
        excelCell(branchSummary.oilSales),
        excelCell(branchSummary.grossSales),
        excelCell(branchSummary.deductions),
        excelCell(branchSummary.expectedCash),
        excelCell(branchSummary.bankDeposit),
        excelCell(branchSummary.confirmedBank),
        excelCell(branchSummary.pendingBank),
        excelCell(branchSummary.pendingCashOnHand),
        excelCell(branchSummary.actualCashCounted),
        excelCell(branchSummary.actualCashDifference, branchSummary.actualCashDifference < 0 ? "RedValue" : "Cell"),
        excelCell(branchSummary.cashVariance, branchSummary.cashVariance < 0 ? "RedValue" : "Cell"),
        excelCell(branchSummary.fuelLiters.Premium),
        excelCell(branchSummary.fuelLiters.Regular),
        excelCell(branchSummary.fuelLiters.Diesel),
        excelCell(branchSummary.totalLiters),
        excelCell(branchSummary.poTotal),
        excelCell(branchSummary.purchaseTotal),
        excelCell(branchSummary.cokeSold),
      ]);
    }),
  ];

  const shiftRegisterRows = [
    sheetTitle("SHIFT REPORT REGISTER", 29),
    excelRow(["BRANCH", "DATE", "SHIFT", "CASHIER", "STATUS", "SUBMITTED AT", "PRICING BASIS", "PREM PRICE", "REG PRICE", "DSL PRICE", "PREM L", "REG L", "DSL L", "TOTAL L", "FUEL SALES", "OIL SALES", "GROSS SALES", "POINTS ISSUED", "POINTS WITHDRAWN", "DEDUCTIONS", "EXPECTED CASH", "BANK", "CONFIRMED BANK", "PENDING BANK", "PENDING CASH ON HAND", "ACTUAL CASH COUNTED", "ACTUAL CASH DIFFERENCE", "CASH VARIANCE", "NOTES"].map((label) => excelCell(label, "Header"))),
    ...exportReports.map((report) => {
      const result = compute(report);
      return excelRow([
        excelCell(report.branch, "Text"),
        excelCell(report.date, "Text"),
        excelCell(shortShiftLabel(report.shiftId), "Text"),
        excelCell(report.cashierName || "", "Text"),
        excelCell(reportStatusText(report), "Text"),
        excelCell(report.confirmedAt || "", "Text"),
        excelCell(report.pricingCoverage || "Daily", "Text"),
        excelCell(n(report.prices?.Premium)),
        excelCell(n(report.prices?.Regular)),
        excelCell(n(report.prices?.Diesel)),
        excelCell(result.fuelLiters.Premium),
        excelCell(result.fuelLiters.Regular),
        excelCell(result.fuelLiters.Diesel),
        excelCell(result.totalLiters),
        excelCell(result.fuelSales),
        excelCell(n(report.oilSales)),
        excelCell(result.grossSales),
        excelCell(result.pointsIssued),
        excelCell(result.pointsWithdrawn),
        excelCell(result.deductionTotal),
        excelCell(result.expectedCash),
        excelCell(result.bankDeposit),
        excelCell(result.confirmedBank),
        excelCell(result.pendingBank),
        excelCell(result.pendingCashOnHand),
        excelCell(result.actualCashCountEntered ? result.actualCashCounted : "", result.actualCashCountEntered ? "Cell" : "Text"),
        excelCell(result.actualCashCountEntered ? result.actualCashDifference : "", result.actualCashDifference < 0 ? "RedValue" : "Cell"),
        excelCell(result.cashVariance, "RedValue"),
        excelCell(reportSourceLabel(report), "Text"),
      ]);
    }),
  ];

  const priceAuditRows = [
    sheetTitle("FUEL PRICE AUDIT", 11),
    excelRow(["BRANCH", "DATE", "SHIFT", "PRODUCT", "MANAGER PRICE", "PRICING COVERAGE", "EFFECTIVE DATE", "EFFECTIVE SHIFT", "LITERS SOLD", "SALES", "REPORT STATUS"].map((label) => excelCell(label, "Header"))),
    ...exportReports.flatMap((report) => {
      const result = compute(report);
      return FUEL_TYPES.map((product) => excelRow([
        excelCell(report.branch, "Text"),
        excelCell(report.date, "Text"),
        excelCell(shortShiftLabel(report.shiftId), "Text"),
        excelCell(product, "Text"),
        excelCell(n(report.prices?.[product])),
        excelCell(report.pricingCoverage || "Daily", "Text"),
        excelCell(report.pricingEffectiveDate || "", "Text"),
        excelCell(report.pricingShiftId ? shortShiftLabel(report.pricingShiftId) : "", "Text"),
        excelCell(result.fuelLiters[product]),
        excelCell(productSales(report, result, product)),
        excelCell(reportStatusText(report), "Text"),
      ]));
    }),
  ];

  const pumpLedgerRows = [
    sheetTitle("PUMP NOZZLE DETAIL", 14),
    excelRow(["BRANCH", "DATE", "SHIFT", "PUMP", "NOZZLE", "PRODUCT", "OPENING", "CLOSING", "LITERS SOLD", "NEGATIVE VARIANCE", "PUMP PRICE", "ESTIMATED SALES", "CASHIER", "REPORT STATUS"].map((label) => excelCell(label, "Header"))),
    ...exportReports.flatMap((report) => (report.pumpRows || []).map((row) => {
      const litersSold = Math.max(0, n(row.closing) - n(row.opening));
      const negativeVariance = Math.min(0, n(row.closing) - n(row.opening));
      const pumpPrice = Math.max(0, n(report.prices?.[row.product]));
      return excelRow([
        excelCell(report.branch, "Text"),
        excelCell(report.date, "Text"),
        excelCell(shortShiftLabel(report.shiftId), "Text"),
        excelCell(row.pump, "Text"),
        excelCell(row.nozzle, "Text"),
        excelCell(row.product, "Text"),
        excelCell(n(row.opening)),
        excelCell(n(row.closing)),
        excelCell(litersSold),
        excelCell(negativeVariance, negativeVariance < 0 ? "RedValue" : "Cell"),
        excelCell(pumpPrice),
        excelCell(litersSold * pumpPrice),
        excelCell(report.cashierName || "", "Text"),
        excelCell(reportStatusText(report), "Text"),
      ]);
    })),
  ];

  const tankLedgerRows = [
    sheetTitle("TANK INVENTORY DETAIL", 15),
    excelRow(["BRANCH", "DATE", "SHIFT", "TANK", "PRODUCT", "PREVIOUS DIP", "DELIVERY", "PULL OUT", "CALIBRATION", "OFFICIAL PUMP LITERS SOLD", "EXPECTED DIP", "ACTUAL DIP", "REFERENCE DIFFERENCE", "CASHIER", "REPORT STATUS"].map((label) => excelCell(label, "Header"))),
    ...exportReports.flatMap((report) => {
      const result = compute(report);
      return result.tankRows.map((row) => excelRow([
        excelCell(report.branch, "Text"),
        excelCell(report.date, "Text"),
        excelCell(shortShiftLabel(report.shiftId), "Text"),
        excelCell(row.tank, "Text"),
        excelCell(row.product, "Text"),
        excelCell(n(row.opening)),
        excelCell(n(row.delivery)),
        excelCell(n(row.pullOut)),
        excelCell(n(row.calibration)),
        excelCell(n(result.fuelLiters[row.product])),
        excelCell(n(row.expectedDip)),
        excelCell(n(row.actualDip)),
        excelCell(n(row.variance), n(row.variance) < 0 ? "RedValue" : "Cell"),
        excelCell(report.cashierName || "", "Text"),
        excelCell(reportStatusText(report), "Text"),
      ]));
    }),
  ];

  const bankAuditRows = [
    sheetTitle("BANK DEPOSIT AUDIT", 13),
    excelRow(["BRANCH", "DATE", "SHIFT", "BANK", "REFERENCE", "AMOUNT", "STATUS", "VERIFIED", "REMOVAL REQUESTED", "REMOVED", "COUNTS IN TOTALS", "CASHIER", "REPORT STATUS"].map((label) => excelCell(label, "Header"))),
    ...exportReports.flatMap((report) => {
      const deposits = report.deposits?.length ? report.deposits : [{ bank: "", reference: "", amount: 0 }];
      return deposits.map((deposit) => excelRow([
        excelCell(report.branch, "Text"),
        excelCell(report.date, "Text"),
        excelCell(shortShiftLabel(report.shiftId), "Text"),
        excelCell(deposit.bank || "", "Text"),
        excelCell(deposit.reference || "", "Text"),
        excelCell(n(deposit.amount)),
        excelCell(depositStatusText(deposit), "Text"),
        excelCell(deposit.verified ? "YES" : "NO", "Text"),
        excelCell(isRemovalRequested(deposit) ? "YES" : "NO", "Text"),
        excelCell(deposit.removed ? "YES" : "NO", "Text"),
        excelCell(deposit.removed ? "NO" : "YES", "Text"),
        excelCell(report.cashierName || "", "Text"),
        excelCell(reportStatusText(report), "Text"),
      ]));
    }),
  ];

  const deductionAuditRows = [
    sheetTitle("DEDUCTION AUDIT DETAIL", 12),
    excelRow(["BRANCH", "DATE", "SHIFT", "CATEGORY", "AMOUNT", "CASHIER", "REPORT STATUS", "REPORT SOURCE", "FUELTECH PAY TOTAL"].map((label) => excelCell(label, "Header"))),
    ...exportReports.flatMap((report) => visibleDeductionEntries(report.deductions || {}).map(([key, value]) => excelRow([
      excelCell(report.branch, "Text"),
      excelCell(report.date, "Text"),
      excelCell(shortShiftLabel(report.shiftId), "Text"),
      excelCell(humanizeKey(key).toUpperCase(), "Text"),
      excelCell(n(value)),
      excelCell(report.cashierName || "", "Text"),
      excelCell(reportStatusText(report), "Text"),
      excelCell(reportSourceLabel(report), "Text"),
      excelCell(fuelTechPayTotal(report.deductions)),
    ]))),
  ];

  const poPrAuditRows = [
    sheetTitle("PO AND CASH VOUCHER AUDIT", 11),
    excelRow(["BRANCH", "DATE", "SHIFT", "TYPE", "CATEGORY", "ACCOUNT / PARTICULAR", "AMOUNT", "CASHIER", "REPORT STATUS", "REPORT SOURCE", "COUNTED AS DEDUCTION"].map((label) => excelCell(label, "Header"))),
    ...exportReports.flatMap((report) => [
      ...(report.poRows || []).map((row) => excelRow([
        excelCell(report.branch, "Text"), excelCell(report.date, "Text"), excelCell(shortShiftLabel(report.shiftId), "Text"),
        excelCell("PO ACCOUNT", "Text"), excelCell("", "Text"), excelCell(row.account || "", "Text"), excelCell(n(row.amount)),
        excelCell(report.cashierName || "", "Text"), excelCell(reportStatusText(report), "Text"), excelCell(reportSourceLabel(report), "Text"), excelCell("YES", "Text"),
      ])),
      ...(report.purchaseRows || []).map((row) => excelRow([
        excelCell(report.branch, "Text"), excelCell(report.date, "Text"), excelCell(shortShiftLabel(report.shiftId), "Text"),
        excelCell("CASH VOUCHER", "Text"), excelCell(row.category || "Uncategorized", "Text"), excelCell(row.item || "", "Text"), excelCell(n(row.amount)),
        excelCell(report.cashierName || "", "Text"), excelCell(reportStatusText(report), "Text"), excelCell(reportSourceLabel(report), "Text"), excelCell("YES", "Text"),
      ])),
    ]),
  ];

  const worksheets = [
    excelWorksheet("SUMMARY", [140, 110, 120, 110, 180], summaryRows),
    excelWorksheet("BRANCH SUMMARY", [92, 74, 98, 98, 98, 98, 104, 104, 104, 104, 104, 112, 112, 88, 78, 78, 78, 88, 88, 78, 78], branchRows),
    excelWorksheet("SHIFT REGISTER", [92, 78, 96, 120, 118, 150, 110, 82, 82, 82, 78, 78, 78, 78, 100, 100, 100, 100, 110, 100, 110, 110, 110, 110, 110, 112, 112, 110, 180], shiftRegisterRows),
    excelWorksheet("DAILY PUMP READING", [...baseColumns, ...productColumns, ...pumps.flatMap(() => productColumns)], pumpRows),
    excelWorksheet("CASH VARIANCE", [92, 74, 96, 82, 82, 82, 110, 82, 82, 82, 82, 82, 82, 110, 110, 110, 120, 120], cashRows),
    excelWorksheet("DEDUCTIONS", [92, 74, 96, 112, 82, 82, 82, 92, 98, 98, 92, 82, 82], deductionsRows),
    excelWorksheet("DIP REFERENCE", [92, 74, 96, 82, 82, 82, 82, 82, 82, 82, 82, 82, 82, 82, 82, 82], ugtRows),
    excelWorksheet("SYSTEM REPORT", [92, 74, 96, 120, 110, 110, 110, 130, 130, 130, 120, 110, 110, 110], systemRows),
    excelWorksheet("PRICE AUDIT", [92, 78, 96, 90, 102, 90, 90, 112, 108, 108, 90, 98, 120], priceAuditRows),
    excelWorksheet("PUMP NOZZLE DETAIL", [92, 78, 96, 86, 90, 86, 94, 94, 94, 108, 90, 104, 120, 120], pumpLedgerRows),
    excelWorksheet("DIP REFERENCE DETAIL", [92, 78, 96, 120, 86, 96, 96, 86, 92, 92, 100, 94, 94, 120, 120], tankLedgerRows),
    excelWorksheet("BANK DEPOSIT AUDIT", [92, 78, 96, 130, 130, 96, 130, 84, 116, 84, 116, 120, 120], bankAuditRows),
    excelWorksheet("DEDUCTION AUDIT", [92, 78, 96, 130, 96, 120, 120, 180, 86, 86, 86, 86], deductionAuditRows),
    excelWorksheet("PO CASH VOUCHER", [92, 78, 96, 120, 110, 180, 96, 120, 120, 180, 120], poPrAuditRows),
    excelWorksheet("DETAILS", detailColumns, detailRows),
  ];

  downloadExcelFile(`FuelTech-Detailed-Reports-${startDate}-to-${endDate}.xls`, baseWorkbookXml(worksheets));
}

function varianceClass(value, tankMode = false) {
  if (n(value) < 0) return "negative";
  if (n(value) > 0) return tankMode ? "neutral" : "positive";
  return "neutral";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withClientSaveMeta(report, clientId, version) {
  return {
    ...report,
    clientSave: {
      clientId,
      version,
      baseVersion: Number(report.serverMeta?.version || 0),
      mutationId: `${clientId}:${version}`,
      startedAt: Date.now(),
      branchDataVersion: BRANCH_DATA_VERSIONS[report.branch] || "",
    },
  };
}

function normalizeReport(report, branch, date, shiftId, prices, pricingMeta = {}) {
  const base = createReport(branch, date, prices, shiftId, pricingMeta);
  const repairedReport = repairAutoApprovedCorrection(report || {});
  const next = { ...base, ...repairedReport };
  next.branch = branch;
  next.date = date;
  next.shiftId = shiftId;
  next.coverage = shiftById(shiftId).label;
  next.pricingCoverage = next.pricingCoverage || pricingMeta.pricingCoverage || "Daily";
  next.pricingEffectiveDate = next.pricingEffectiveDate || pricingMeta.pricingEffectiveDate || "";
  next.pricingShiftId = next.pricingShiftId || pricingMeta.pricingShiftId || "";
  next.prices = { ...defaultPrices(), ...(next.prices || {}) };
  const existingPumpRows = Array.isArray(next.pumpRows) && next.pumpRows.length > 0
    ? next.pumpRows
    : base.pumpRows;
  const configuredPumpKeys = new Set(base.pumpRows.map((row) => pumpCarryKey(row)));
  const existingPumpByKey = Object.fromEntries(existingPumpRows.map((row) => [pumpCarryKey(row), row]));
  const pumpRowsForReport = reportCompleted(next)
    ? existingPumpRows
    : [
      ...base.pumpRows.map((row) => existingPumpByKey[pumpCarryKey(row)] || {
        ...row,
        opening: "",
        setupRequired: true,
      }),
      ...existingPumpRows.filter((row) => !configuredPumpKeys.has(pumpCarryKey(row))),
    ];
  next.pumpRows = pumpRowsForReport.map((row) => {
      const source = row.closingEntrySource || "";
      const entered = Boolean(
        next.confirmed
        || source === "cashier"
        || source === "baseline"
        || (row.closing !== "" && n(row.closing) > 0 && n(row.closing) !== n(row.opening))
      );
      return {
        ...row,
        closing: entered ? row.closing : "",
        closingEntered: entered,
        closingEntrySource: entered ? source : "",
      };
    });
  next.pumpConfigVersion = reportCompleted(next)
    ? next.pumpConfigVersion || PUMP_CONFIG_VERSION
    : PUMP_CONFIG_VERSION;
  next.tankRows = Array.isArray(next.tankRows) && next.tankRows.length > 0 ? next.tankRows : base.tankRows;
  next.baselineConfirmed = baselineConfirmed(next);
  delete next.baseline_confirmed;
  next.poRows = Array.isArray(next.poRows) ? next.poRows : [];
  next.purchaseRows = Array.isArray(next.purchaseRows) ? next.purchaseRows : [];
  next.midShiftPriceChanges = Array.isArray(next.midShiftPriceChanges)
    ? next.midShiftPriceChanges.map((change) => ({
      id: change.id || uid(),
      product: FUEL_TYPES.includes(change.product) ? change.product : "Premium",
      effectiveTime: change.effectiveTime || "",
      newPrice: n(change.newPrice),
      readings: change.readings || {},
    }))
    : [];
  next.pointsIssued = n(next.pointsIssued);
  next.pointsWithdrawn = pointsWithdrawnFromRedemptions(next);
  next.actualCashCounted = hasActualCashCounted(next)
    ? normalizeCashCountInput(next.actualCashCounted) ?? next.actualCashCounted
    : "";
  next.deposits = Array.isArray(next.deposits)
    ? next.deposits.map((deposit) => {
      const removalRequested = Boolean(deposit.removalRequested || deposit.removal_requested);
      return {
        removed: false,
        ...deposit,
        removalRequested,
        removal_requested: removalRequested,
      };
    })
    : [];
  next.deductions = cleanDeductions({ ...base.deductions, ...(next.deductions || {}) });
  next.coke = { ...base.coke, ...(next.coke || {}) };
  return next;
}

async function loadOnlineStore(sessionToken) {
  const { priceRows = [], reportRows = [] } = await apiPost("/api/store/load", {}, sessionToken);

  const nextStore = emptyStore();

  const priceResetTime = Date.parse(PRICE_HISTORY_RESET_AT);
  (priceRows || []).filter((row) => {
    const updatedAt = Date.parse(row.updated_at || "");
    return Number.isNaN(priceResetTime) || (!Number.isNaN(updatedAt) && updatedAt >= priceResetTime);
  }).forEach((row) => {
    const key = row.coverage === "Shift"
      ? shiftPriceKey(row.effective_date, row.shift_id || "shift-1")
      : dailyPriceKey(row.effective_date);
    nextStore.priceBook[row.branch] = {
      ...(nextStore.priceBook[row.branch] || {}),
      [key]: { ...defaultPrices(), ...defaultFuelCosts(), ...(row.prices || {}) },
    };
  });

  const resetTime = Date.parse(REPORT_HISTORY_RESET_AT);
  (reportRows || []).filter((row) => {
    const updatedAt = Date.parse(row.updated_at || "");
    return Number.isNaN(resetTime) || (!Number.isNaN(updatedAt) && updatedAt >= resetTime);
  }).forEach((row) => {
    const pricing = getEffectivePricing(nextStore.priceBook, row.branch, row.report_date, row.shift_id);
    nextStore.reports[row.report_key] = normalizeReport(row.data, row.branch, row.report_date, row.shift_id, pricing.prices, pricing);
  });

  nextStore.reports = syncReportsWithPriceBook(nextStore.reports, nextStore.priceBook);

  return nextStore;
}

async function loadOnlinePriceBook(sessionToken) {
  const { priceRows = [] } = await apiPost("/api/prices/load", {}, sessionToken);
  const priceBook = emptyStore().priceBook;
  const priceResetTime = Date.parse(PRICE_HISTORY_RESET_AT);
  priceRows.filter((row) => {
    const updatedAt = Date.parse(row.updated_at || "");
    return Number.isNaN(priceResetTime) || (!Number.isNaN(updatedAt) && updatedAt >= priceResetTime);
  }).forEach((row) => {
    const key = row.coverage === "Shift"
      ? shiftPriceKey(row.effective_date, row.shift_id || "shift-1")
      : dailyPriceKey(row.effective_date);
    priceBook[row.branch] = {
      ...(priceBook[row.branch] || {}),
      [key]: { ...defaultPrices(), ...(row.prices || {}) },
    };
  });
  return priceBook;
}

async function loadSystemHealth(sessionToken) {
  return apiPost("/api/admin/system-health", {}, sessionToken);
}

async function loadRealtimeConfig(sessionToken) {
  return apiPost("/api/realtime/config", {}, sessionToken);
}

async function runBackupRestoreTest(sessionToken) {
  return apiPost("/api/admin/backup-restore-test", {}, sessionToken);
}

async function saveOnlineReport(report, sessionToken, operation = "save") {
  const clean = normalizeReport(report, report.branch, report.date, report.shiftId || "shift-1", report.prices || defaultPrices(), {
    pricingCoverage: report.pricingCoverage,
    pricingEffectiveDate: report.pricingEffectiveDate,
    pricingShiftId: report.pricingShiftId,
  });
  return apiPost("/api/reports/save", { report: clean, operation }, sessionToken);
}

function readOfflineQueue() {
  return readStorageMap(OFFLINE_QUEUE_KEY);
}

function queueOfflineReport(report) {
  const queue = readOfflineQueue();
  queue[reportKey(report.branch, report.date, report.shiftId)] = report;
  writeStorageMap(OFFLINE_QUEUE_KEY, queue);
}

function removeQueuedReport(report) {
  const queue = readOfflineQueue();
  const key = reportKey(report.branch, report.date, report.shiftId);
  if (queue[key]?.clientSave?.mutationId !== report.clientSave?.mutationId) return;
  delete queue[key];
  writeStorageMap(OFFLINE_QUEUE_KEY, queue);
}

function removeQueuedReportByKey(key) {
  const queue = readOfflineQueue();
  if (!queue[key]) return;
  delete queue[key];
  writeStorageMap(OFFLINE_QUEUE_KEY, queue);
}

async function flushOfflineReports(sessionToken, allowedBranch = "") {
  for (const [key, report] of Object.entries(readOfflineQueue()).filter(([, item]) => !allowedBranch || item?.branch === allowedBranch)) {
    if (shouldDiscardOfflineReport(report, GLOBAL_OPENING_DATE)) {
      removeQueuedReportByKey(key);
      if (report) removeLocalDraft(report);
      continue;
    }
    const clientId = report.clientSave?.clientId || deviceClientId();
    const version = nextDeviceSaveVersion(report.clientSave?.version);
    const rebasedReport = withClientSaveMeta(report, clientId, version);
    cacheLocalDraft(rebasedReport);
    queueOfflineReport(rebasedReport);
    try {
      const result = await saveOnlineReport(rebasedReport, sessionToken);
      removeQueuedReport(rebasedReport);
      if (reportCompleted(result.report)) removeLocalDraft(result.report);
    } catch (error) {
      if (error.status === 423) {
        removeQueuedReport(rebasedReport);
        removeLocalDraft(rebasedReport);
        continue;
      }
      if (!error.staleDraft && !error.resetSave && !isCleanRestartRejection(error)) throw error;
      removeQueuedReport(rebasedReport);
      removeLocalDraft(rebasedReport);
    }
  }
}

async function requestReportLease({ branch, date, shiftId, clientId, actor, action = "acquire", sessionToken }) {
  return apiPost("/api/reports/lease", { branch, date, shiftId, clientId, actor, action }, sessionToken);
}

async function saveOnlinePrices(branch, date, coverage, shiftId, prices, sessionToken) {
  await apiPost("/api/prices/save", { branch, date, coverage, shiftId, prices: { ...defaultPrices(), ...defaultFuelCosts(), ...prices } }, sessionToken);
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function TextInput({ value, onChange, type = "text", ...props }) {
  return <input {...props} type={type} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />;
}

function BranchPinInput({ value, onChange, onSubmit }) {
  return (
    <input
      className="branch-pin-input"
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="current-password"
      maxLength={6}
      value={value ?? ""}
      aria-label="Six-digit branch PIN"
      onInput={(event) => onChange(normalizeBranchPinDraft(event.currentTarget.value))}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSubmit();
      }}
    />
  );
}

function NumberInput({ value, onChange, placeholder = "", className = "", ghostZero = false }) {
  const displayValue = ghostZero && value === 0 ? "" : value ?? "";
  return (
    <input
      className={`${className} ${ghostZero ? "ghost-zero-input" : ""}`.trim()}
      type="text"
      inputMode="decimal"
      value={displayValue}
      placeholder={ghostZero ? "0" : placeholder}
      onChange={(event) => {
        const nextValue = event.target.value.replace(",", ".");
        if (DECIMAL_INPUT_PATTERN.test(nextValue)) onChange(nextValue);
      }}
      onWheel={(event) => event.currentTarget.blur()}
    />
  );
}

function CashCountInput({ value, onChange }) {
  const normalizedValue = normalizeCashCountInput(value);
  const displayValue = normalizedValue === "0" ? "" : formatCashCountInput(normalizedValue ?? "");

  return (
    <input
      className="ghost-zero-input"
      type="text"
      inputMode="decimal"
      value={displayValue}
      placeholder="0"
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => {
        const normalized = normalizeCashCountInput(event.target.value);
        if (normalized !== null) onChange(normalized);
      }}
      onWheel={(event) => event.currentTarget.blur()}
    />
  );
}

function ManagerPriceInput({ value, onCommit, ghostZero = false }) {
  const formatValue = (nextValue) => {
    if (nextValue === "" || nextValue === null || nextValue === undefined) return "";
    if (ghostZero && Number(nextValue) === 0) return "";
    return committedManagerPrice(nextValue) || "";
  };
  const [draft, setDraft] = useState(() => formatValue(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(formatValue(value));
  }, [value, editing]);

  function commit() {
    setEditing(false);
    const formatted = committedManagerPrice(draft);
    if (formatted === null) {
      setDraft(formatValue(value));
      return;
    }
    setDraft(formatted);
    onCommit(formatted);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      placeholder={ghostZero ? "" : "0.00"}
      autoComplete="off"
      spellCheck={false}
      onFocus={(event) => {
        setEditing(true);
        event.currentTarget.select();
      }}
      onChange={(event) => {
        const nextValue = normalizeManagerPriceDraft(event.target.value);
        if (nextValue !== null) setDraft(nextValue);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        const isDecimalKey = event.key === "." || event.key === "," || event.key === "Decimal" || event.code === "NumpadDecimal";
        if (isDecimalKey) {
          event.preventDefault();
          const input = event.currentTarget;
          const next = insertManagerPriceDecimal(draft, input.selectionStart, input.selectionEnd);
          if (next) {
            setDraft(next.value);
            window.requestAnimationFrame(() => input.setSelectionRange(next.caret, next.caret));
          }
          return;
        }
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      onWheel={(event) => event.currentTarget.blur()}
    />
  );
}

function SelectInput({ value, onChange, options }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => {
        const optionValue = typeof option === "string" ? option : option.value;
        const optionLabel = typeof option === "string" ? option : option.label;
        return <option key={optionValue} value={optionValue}>{optionLabel}</option>;
      })}
    </select>
  );
}

function Section({ title, children, id, className = "" }) {
  return (
    <section id={id} className={`section ${className}`.trim()}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Card({ title, value, note, tone = "" }) {
  return (
    <div className={`card ${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function Status({ children, tone }) {
  return <span className={`status ${tone}`}>{children}</span>;
}

function ReviewBadge({ flags }) {
  return <Status tone={flags.length ? "yellow" : "green"}>{flags.length ? "Check Required" : "Normal"}</Status>;
}

function reportStatusLabel(report, flags = []) {
  if (!reportCompleted(report)) return "Draft";
  return flags.length ? "Submitted - Check Required" : "Submitted";
}

function reportStatusTone(report, flags = []) {
  if (!reportCompleted(report)) return "yellow";
  return flags.length ? "yellow" : "green";
}

function WarningBanner({ children, critical = false }) {
  return <div className={critical ? "critical-box" : "warning-box"}>{children}</div>;
}

function CashierSaveStatus({ status }) {
  return (
    <div className={`cashier-save-status ${status.tone}`} role="status" aria-live="polite">
      <span className="cashier-save-status-dot" aria-hidden="true" />
      <div>
        <b>{status.title}</b>
        <small>{status.detail}</small>
      </div>
    </div>
  );
}

function MissingPreviousShiftWarning({ info, onGoToMissingShift }) {
  if (!info) return null;
  return (
    <WarningBanner critical>
      <div className="missing-shift-warning">
        <strong>Previous shift is missing.</strong>
        <span>
          Please complete {info.missingDate} {shiftById(info.missingShiftId).label} first so pump readings stay correct.
        </span>
        <button type="button" className="confirm-button" onClick={() => onGoToMissingShift(info)}>
          Go to Missing Shift
        </button>
      </div>
    </WarningBanner>
  );
}

function Table({ headers, children, minWidth = "760px" }) {
  return (
    <div className="table-wrap">
      <table style={{ minWidth }}>
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function EditableList({ title, rows, firstLabel, firstKey, total, onChange, onAdd, onDelete, ghostZero = false }) {
  function patch(id, key, value) {
    onChange(rows.map((row) => row.id === id ? { ...row, [key]: value } : row));
  }

  return (
    <Section title={title}>
      <Table headers={[firstLabel, "Amount", "Action"]} minWidth="560px">
        {rows.map((row) => (
          <tr key={row.id}>
            <td><TextInput value={row[firstKey]} onChange={(value) => patch(row.id, firstKey, value)} /></td>
            <td><NumberInput ghostZero={ghostZero} value={row.amount} onChange={(value) => patch(row.id, "amount", value)} /></td>
            <td><button type="button" className="small-danger" onClick={() => onDelete(row.id)}>Remove</button></td>
          </tr>
        ))}
        <tr className="total-row">
          <td>Total</td>
          <td>{peso(total)}</td>
          <td />
        </tr>
      </Table>
      <button type="button" className="secondary" onClick={onAdd}>Add Row</button>
    </Section>
  );
}

function PoTransactionList({ rows, total }) {
  return (
    <Section title="PO Accounts">
      <p className="neutral">Automatically calculated from posted FuelTech Pay PO transactions. Cashiers cannot edit this total.</p>
      <Table headers={["Transaction", "Customer", "Vehicle", "Fuel / Liters", "Amount"]} minWidth="760px">
        {rows.length ? rows.map((row) => (
          <tr key={row.id}>
            <td><b>{row.transactionNumber}</b></td>
            <td>{row.account}</td>
            <td>{row.plateNumber || row.vehicle}</td>
            <td>{row.fuelType} · {n(row.liters).toFixed(2)} L</td>
            <td><b>{peso(row.amount)}</b></td>
          </tr>
        )) : <tr><td colSpan="5">No posted PO transactions for this station and shift.</td></tr>}
        <tr className="total-row"><td colSpan="4">TOTAL PO</td><td>{peso(total)}</td></tr>
      </Table>
    </Section>
  );
}

function cashVoucherValidationError(report) {
  if (report.date < CASH_VOUCHER_START_DATE) return "";
  for (const row of report.purchaseRows || []) {
    if (!CASH_VOUCHER_CATEGORIES.includes(row.category)) return "Choose OPEX, Personal, or Construction for every cash voucher.";
    if (!String(row.item || "").trim()) return "Enter the particular for every cash voucher.";
    if (!Number.isFinite(Number(row.amount)) || Number(row.amount) <= 0) return "Enter an amount greater than zero for every cash voucher.";
  }
  return "";
}

function CashVoucherList({ rows, total, onChange, onAdd, onDelete }) {
  function patch(id, key, value) {
    onChange(rows.map((row) => row.id === id ? { ...row, [key]: value } : row));
  }

  return (
    <Section title="Cash Vouchers">
      <Table headers={["Category", "Particular", "Amount", "Action"]} minWidth="720px">
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <SelectInput
                value={row.category || ""}
                onChange={(value) => patch(row.id, "category", value)}
                options={[
                  { value: "", label: "Select category" },
                  ...CASH_VOUCHER_CATEGORIES,
                ]}
              />
            </td>
            <td><TextInput value={row.item || ""} onChange={(value) => patch(row.id, "item", value)} /></td>
            <td><NumberInput ghostZero value={row.amount} onChange={(value) => patch(row.id, "amount", value)} /></td>
            <td><button type="button" className="small-danger" onClick={() => onDelete(row.id)}>Remove</button></td>
          </tr>
        ))}
        <tr className="total-row">
          <td colSpan="2">Total</td>
          <td>{peso(total)}</td>
          <td />
        </tr>
      </Table>
      <button type="button" className="secondary" onClick={onAdd}>Add Cash Voucher</button>
    </Section>
  );
}

export default function App() {
  const currentShift = useMemo(() => getCurrentShift(), []);
  const [cachedCashierSession] = useState(() => roleFromPath(window.location.pathname) === "Cashier" ? readCachedCashierSession() : null);
  const [store, setStore] = useState(() => storeWithLocalDrafts());
  const [role, setRole] = useState(() => roleFromPath(window.location.pathname));
  const [branch, setBranch] = useState(() => cachedCashierSession?.branch || "Mabolo");
  const [currentDate, setCurrentDate] = useState(currentShift.date);
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [selectedShiftId, setSelectedShiftId] = useState(currentShift.id);
  const [pricingCoverage, setPricingCoverage] = useState("Daily");
  const [pricingShiftId, setPricingShiftId] = useState(currentShift.id);
  const [range, setRange] = useState("1 Week");
  const [summaryStartDate, setSummaryStartDate] = useState(() => roleFromPath(window.location.pathname) === "Approver" ? "2026-07-29" : dateOffset(TODAY, -7));
  const [summaryEndDate, setSummaryEndDate] = useState(TODAY);
  const [rankingRange, setRankingRange] = useState("Weekly");
  const [mobileStationBranch, setMobileStationBranch] = useState("Liloan");
  const [mobileStationStartDate, setMobileStationStartDate] = useState(dateOffset(TODAY, -7));
  const [mobileStationEndDate, setMobileStationEndDate] = useState(TODAY);
  const [healthStartDate, setHealthStartDate] = useState(TODAY);
  const [healthEndDate, setHealthEndDate] = useState(TODAY);
  const [depositDate, setDepositDate] = useState(TODAY);
  const [depositSalesDate, setDepositSalesDate] = useState(TODAY);
  const [depositHistoryFrom, setDepositHistoryFrom] = useState(dateOffset(TODAY, -6));
  const [depositHistoryTo, setDepositHistoryTo] = useState(TODAY);
  const [depositCoverage, setDepositCoverage] = useState("shift-1");
  const [depositDraft, setDepositDraft] = useState({ bank: "", reference: "", amount: 0 });
  const [correctionDraft, setCorrectionDraft] = useState({ date: currentShift.date, shiftId: currentShift.id, reason: "" });
  const [pin, setPin] = useState("");
  const [cashierAccess, setCashierAccess] = useState(() => cachedCashierSession ? { [cachedCashierSession.branch]: true } : {});
  const [managerAccess, setManagerAccess] = useState({});
  const [adminAccess, setAdminAccess] = useState(false);
  const [approverAccess, setApproverAccess] = useState(false);
  const [sessionToken, setSessionToken] = useState(() => cachedCashierSession ? "cookie" : "");
  const [authMessage, setAuthMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(() => roleFromPath(window.location.pathname) === "Admin");
  const [adminSessionExpiresAt, setAdminSessionExpiresAt] = useState(0);
  const [syncMessage, setSyncMessage] = useState("Connecting online accounting database...");
  const [showReportConfirm, setShowReportConfirm] = useState(false);
  const [submitReportError, setSubmitReportError] = useState("");
  const [cashierReportOpen, setCashierReportOpen] = useState(false);
  const [cashierReportDateOverride, setCashierReportDateOverride] = useState("");
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [hasUnsavedOnlineChange, setHasUnsavedOnlineChange] = useState(false);
  const [isSavingOnline, setIsSavingOnline] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState("");
  const [initialLoadFinished, setInitialLoadFinished] = useState(false);
  const [initialLoadError, setInitialLoadError] = useState("");
  const [lastOnlineSave, setLastOnlineSave] = useState({ reportKey: "", at: "" });
  const [systemHealth, setSystemHealth] = useState({ loading: false, error: "", backupReady: false, healthReady: false, latestBackup: null, latestHealth: null });
  const [clientId] = useState(() => deviceClientId());
  const [activeEditors, setActiveEditors] = useState([]);
  const isSavingOnlineRef = useRef(false);
  const hasUnsavedOnlineChangeRef = useRef(false);
  const localChangeVersionRef = useRef(readDeviceSaveVersion());
  const pendingSaveCountRef = useRef(0);
  const pendingSaveRef = useRef(Promise.resolve());
  const draftSaveTimerRef = useRef(null);
  const pendingDraftReportRef = useRef(null);
  const activeReportRef = useRef(null);
  const localDraftCacheTimerRef = useRef(null);
  const pendingLocalDraftCacheRef = useRef(null);
  const priceRefreshInFlightRef = useRef(false);
  const hasLoadedOnlineStoreRef = useRef(false);
  const reopenedStartingReport = role === "Cashier" ? reopenedStartingOpeningReport(store.reports, branch) : null;
  const activeCorrectionReport = role === "Cashier" ? approvedCorrectionReport(store.reports, branch) : null;
  const pendingCorrection = role === "Cashier" ? pendingCorrectionReport(store.reports, branch) : null;
  const correctionCardReport = activeCorrectionReport || pendingCorrection;
  const reportingDate = useMemo(() => branchReportingDate(store.reports, branch), [store.reports, branch]);
  const activeDate = role === "Cashier" ? (reopenedStartingReport?.date || cashierReportDateOverride || reportingDate) : selectedDate;
  const activeShiftId = role === "Cashier" ? (reopenedStartingReport?.shiftId || selectedShiftId) : selectedShiftId;
  const accessAllowed = (role === "Admin" && adminAccess)
    || (role === "Approver" && approverAccess)
    || (role === "Cashier" && cashierAccess[branch])
    || (role === "Manager" && managerAccess[branch]);

  useEffect(() => {
    if (roleFromPath(window.location.pathname) !== "Admin") return undefined;
    let mounted = true;
    restoreAdminLoginSession()
      .then((session) => {
        if (!mounted || !session) return;
        setSessionToken("cookie");
        setAdminAccess(true);
        setAdminSessionExpiresAt(Number(session.expiresAt) || 0);
      })
      .finally(() => mounted && setAuthLoading(false));
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (role !== "Admin" || !adminAccess || !adminSessionExpiresAt) return undefined;
    const remaining = adminSessionExpiresAt - Date.now();
    if (remaining <= 0) {
      logout();
      return undefined;
    }
    const timer = window.setTimeout(logout, remaining);
    return () => window.clearTimeout(timer);
  }, [role, adminAccess, adminSessionExpiresAt]);

  useEffect(() => {
    function updateRouteRole() {
      setRole(roleFromPath(window.location.pathname));
      setAuthMessage("");
    }

    window.addEventListener("popstate", updateRouteRole);
    return () => window.removeEventListener("popstate", updateRouteRole);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentDate(cashierBusinessDate()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    isSavingOnlineRef.current = isSavingOnline;
  }, [isSavingOnline]);

  useEffect(() => {
    hasUnsavedOnlineChangeRef.current = hasUnsavedOnlineChange;
  }, [hasUnsavedOnlineChange]);

  useEffect(() => {
    function flushPendingLocalDraft() {
      if (localDraftCacheTimerRef.current) window.clearTimeout(localDraftCacheTimerRef.current);
      localDraftCacheTimerRef.current = null;
      const latestDraft = pendingLocalDraftCacheRef.current;
      pendingLocalDraftCacheRef.current = null;
      if (!latestDraft) return;
      cacheLocalDraft(latestDraft);
      queueOfflineReport(latestDraft);
    }

    function flushWhenHidden() {
      if (document.visibilityState === "hidden") flushPendingLocalDraft();
    }

    window.addEventListener("pagehide", flushPendingLocalDraft);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      flushPendingLocalDraft();
      window.removeEventListener("pagehide", flushPendingLocalDraft);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, []);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      setSyncMessage("Back online. Syncing reports...");
    }

    function handleOffline() {
      setIsOnline(false);
      if (hasUnsavedOnlineChangeRef.current || isSavingOnlineRef.current) {
        setHasUnsavedOnlineChange(true);
        setSyncMessage("Not saved online yet.");
        return;
      }
      setSyncMessage("Offline. Saved reports stay online; new changes need internet.");
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.removeItem(STORE_KEY);
    } catch {
      // Ignore private browser storage errors.
    }

    if (!accessAllowed || !sessionToken) {
      setStore(emptyStore());
      hasLoadedOnlineStoreRef.current = false;
      setInitialLoadFinished(false);
      setInitialLoadError("");
      setSyncMessage("Log in to load online accounting data.");
      return undefined;
    }

    let mounted = true;
    let stopRealtime = () => {};
    let realtimeRefreshTimer = 0;
    hasLoadedOnlineStoreRef.current = false;
    setInitialLoadFinished(false);
    setInitialLoadError("");

    async function refreshOnlineStore(silent = false) {
      if (silent && (pendingSaveCountRef.current > 0 || isSavingOnlineRef.current || hasUnsavedOnlineChangeRef.current)) return;
      const refreshStartedAtVersion = localChangeVersionRef.current;
      if (!silent) setSyncMessage("Connecting online accounting database...");
      try {
        let onlineStore = await loadOnlineStore(sessionToken);
        if (navigator.onLine && role !== "Approver") {
          await flushOfflineReports(sessionToken, role === "Admin" ? "" : branch);
          onlineStore = await loadOnlineStore(sessionToken);
        }
        if (!mounted) return;
        if (refreshStartedAtVersion !== localChangeVersionRef.current || pendingSaveCountRef.current > 0) return;
        setStore(role === "Approver" ? onlineStore : storeWithLocalDrafts(onlineStore, role === "Admin" ? "" : branch));
        hasLoadedOnlineStoreRef.current = true;
        if (role === "Admin") {
          loadSystemHealth(sessionToken)
            .then((health) => mounted && setSystemHealth({ loading: false, error: "", ...health }))
            .catch((error) => mounted && setSystemHealth((old) => ({ ...old, loading: false, error: error.message || "Unable to load system health." })));
        }
        setHasUnsavedOnlineChange(false);
        setInitialLoadError("");
        setLastRefreshedAt(new Date().toISOString());
        setSyncMessage("Online database connected.");
      } catch (error) {
        if (!mounted) return;
        if (error.status === 401) {
          window.sessionStorage.removeItem(CASHIER_SESSION_CACHE_KEY);
          setStore(emptyStore());
          setSessionToken("");
          setCashierAccess({});
          setManagerAccess({});
          setAdminAccess(false);
          setAdminSessionExpiresAt(0);
          setApproverAccess(false);
          setInitialLoadError("");
          setAuthMessage("Your session expired. Enter the PIN again to load the latest reports.");
          setSyncMessage("Session expired. Please log in again.");
          return;
        }
        if (hasLoadedOnlineStoreRef.current) {
          setInitialLoadError("");
          setSyncMessage("Unable to refresh right now. Showing the last saved online data.");
          return;
        }
        if (!navigator.onLine && role === "Cashier") {
          setHasUnsavedOnlineChange(Object.keys(readLocalDrafts()).length > 0);
          const message = "No internet connection. Reconnect before loading saved shift statuses.";
          setInitialLoadError(message);
          setSyncMessage(message);
        } else {
          const message = error.message || "Unable to connect online accounting database.";
          setInitialLoadError(message);
          setSyncMessage(message);
        }
      } finally {
        if (mounted) setInitialLoadFinished(true);
      }
    }

    refreshOnlineStore();

    loadRealtimeConfig(sessionToken)
      .then((config) => {
        if (!mounted || !config.enabled) return;
        stopRealtime = subscribeToStoreChanges({
          url: config.url,
          publishableKey: config.publishableKey,
          onChange: () => {
            if (!mounted || document.hidden) return;
            window.clearTimeout(realtimeRefreshTimer);
            realtimeRefreshTimer = window.setTimeout(() => refreshOnlineStore(true), 750);
          },
          onStatus: (status) => {
            if (!mounted || !hasLoadedOnlineStoreRef.current) return;
            if (status === "SUBSCRIBED") setSyncMessage("Live updates connected.");
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              setSyncMessage("Live updates reconnecting. Your saved data remains available.");
            }
          },
        });
      })
      .catch(() => {
        if (mounted && hasLoadedOnlineStoreRef.current) {
          setSyncMessage("Online database connected. Live updates will retry when this page is reopened.");
        }
      });

    function refreshWhenVisible() {
      if (!document.hidden) refreshOnlineStore(true);
    }

    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      mounted = false;
      window.clearTimeout(realtimeRefreshTimer);
      stopRealtime();
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [accessAllowed, sessionToken, role, branch]);

  useEffect(() => {
    if (!accessAllowed || !sessionToken || role !== "Cashier" || !cashierReportOpen) {
      setActiveEditors([]);
      return undefined;
    }
    let stopped = false;
    const leaseArgs = { branch, date: activeDate, shiftId: activeShiftId, clientId, actor: "Cashier", sessionToken };

    async function renewLease(action = "acquire") {
      try {
        const result = await requestReportLease({ ...leaseArgs, action });
        if (!stopped) setActiveEditors(result.editor?.clientId && result.editor.clientId !== clientId ? [result.editor] : []);
      } catch (error) {
        if (!stopped && error.conflict) setActiveEditors([error.editor || { actor: "Another cashier" }]);
      }
    }

    renewLease();
    const interval = window.setInterval(() => renewLease("heartbeat"), 60_000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      requestReportLease({ ...leaseArgs, action: "release" }).catch(() => {});
    };
  }, [accessAllowed, role, branch, activeDate, activeShiftId, clientId, sessionToken, cashierReportOpen]);

  useEffect(() => {
    if (!accessAllowed || !sessionToken || role !== "Cashier" || !cashierReportOpen) return undefined;
    refreshCashierPrices(true);
    return undefined;
  }, [accessAllowed, sessionToken, role, branch, cashierReportOpen, activeDate, activeShiftId]);

  function openRole(path) {
    window.history.pushState({}, "", path);
    setRole(roleFromPath(path));
    setAuthMessage("");
  }

  const activePricing = useMemo(() => getEffectivePricing(store.priceBook, branch, activeDate, activeShiftId), [store.priceBook, branch, activeDate, activeShiftId]);
  const effectivePrices = activePricing.prices;
  const managerPricingKey = pricingCoverage === "Shift" ? shiftPriceKey(selectedDate, pricingShiftId) : dailyPriceKey(selectedDate);
  const managerPrices = store.priceBook[branch]?.[managerPricingKey] || (pricingCoverage === "Shift"
    ? getEffectivePricing(store.priceBook, branch, selectedDate, pricingShiftId).prices
    : getEffectivePricing(store.priceBook, branch, selectedDate, activeShiftId).prices);

  const activeReport = useMemo(() => {
    const key = reportKey(branch, activeDate, activeShiftId);
    const storedReport = store.reports[key];
    if (reportCompleted(storedReport)) return storedReport;

    const baseReport = !storedReport
      ? createReport(branch, activeDate, effectivePrices, activeShiftId, activePricing)
      : normalizeReport({
      ...storedReport,
      prices: activePricing.prices,
      pricingCoverage: activePricing.pricingCoverage,
      pricingEffectiveDate: activePricing.pricingEffectiveDate,
      pricingShiftId: activePricing.pricingShiftId,
    }, branch, activeDate, activeShiftId, activePricing.prices, activePricing);
    return carryForwardOpenings(baseReport, store.reports);
  }, [store.reports, branch, activeDate, activeShiftId, effectivePrices, activePricing]);
  const displayedManagerPrices = managerPrices;

  useEffect(() => {
    activeReportRef.current = activeReport;
  }, [activeReport]);

  function reportForTarget(targetBranch, targetDate, targetShiftId) {
    const storedReport = store.reports[reportKey(targetBranch, targetDate, targetShiftId)];
    if (storedReport) return storedReport;

    const pricing = getEffectivePricing(store.priceBook, targetBranch, targetDate, targetShiftId);
    return carryForwardOpenings(createReport(targetBranch, targetDate, pricing.prices, targetShiftId, pricing), store.reports);
  }

  const depositShiftIds = useMemo(() => depositCoverageShiftIds(depositCoverage), [depositCoverage]);
  const managerDepositRows = useMemo(() => Object.values(store.reports)
    .filter((item) => item?.branch === branch)
    .flatMap((report) => activeDeposits(report).map((deposit) => ({ report, deposit })))
    .filter(({ report, deposit }) => {
      const salesDate = deposit.salesDateCovered || report.date;
      return salesDate >= depositHistoryFrom && salesDate <= depositHistoryTo;
    })
    .sort((a, b) =>
      `${b.deposit.salesDateCovered || b.report.date}|${b.report.shiftId}`.localeCompare(`${a.deposit.salesDateCovered || a.report.date}|${a.report.shiftId}`)
    ), [store.reports, branch, depositHistoryFrom, depositHistoryTo]);

  const activeResult = useMemo(() => compute(activeReport), [activeReport]);
  const activeWarnings = useMemo(() => reportWarnings(activeReport, activeResult), [activeReport, activeResult]);
  const activeCriticalWarnings = useMemo(() => criticalReportWarnings(activeReport, activeResult), [activeReport, activeResult]);
  const editingConflict = role === "Cashier" && activeEditors.length > 0;
  const saveWarning = !isOnline || hasUnsavedOnlineChange || isSavingOnline;
  const saveWarningText = !isOnline
    ? "No internet connection. New changes cannot be saved online yet."
    : isSavingOnline
      ? "Saving online. Please keep this page open."
      : "Not saved online yet. Please keep this page open until the status says saved online.";
  const activeReportKey = reportKey(activeReport.branch, activeReport.date, activeReport.shiftId);
  const activeSavedOnlineAt = activeReport.serverMeta?.savedAt
    || activeReport.confirmedAt
    || (lastOnlineSave.reportKey === activeReportKey ? lastOnlineSave.at : "");
  const cashierSaveStatus = isSavingOnline
    ? { tone: "saving", title: "Saving online", detail: "Your latest changes are already saved on this device." }
    : !isOnline
      ? hasUnsavedOnlineChange
        ? { tone: "offline", title: "Saved on this device", detail: "Waiting for internet. Keep using this same device." }
        : { tone: "offline", title: "Offline", detail: "Previously saved reports remain protected online." }
      : hasUnsavedOnlineChange
        ? { tone: "pending", title: "Saved on this device", detail: syncMessage || "Waiting to finish the online save." }
        : activeSavedOnlineAt
          ? { tone: "saved", title: `Saved online at ${new Date(activeSavedOnlineAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", second: "2-digit" })}`, detail: reportCompleted(activeReport) ? "Report submitted and locked." : "Draft recovery is ready." }
          : { tone: "ready", title: "Online autosave ready", detail: "Changes save after you finish typing." };
  const activeMissingPreviousShift = useMemo(() => missingPreviousShiftInfo(activeReport, store.reports), [activeReport, store.reports]);

  const rangeReports = useMemo(() => {
    const keys = [];
    rangeDates(selectedDate, range).forEach((date) => {
      SHIFT_OPTIONS.forEach((shift) => {
        if (role === "Admin" || role === "Approver") BRANCHES.forEach((b) => keys.push(reportKey(b, date, shift.id)));
        else keys.push(reportKey(branch, date, shift.id));
      });
    });
    return keys.map((key) => store.reports[key]).filter(Boolean);
  }, [store.reports, selectedDate, range, role, branch]);

  const rangeSummary = useMemo(() => summarizeReports(rangeReports), [rangeReports]);

  const adminSummaryReports = useMemo(() => {
    const dates = datesBetween(summaryStartDate, summaryEndDate);
    const keys = [];
    dates.forEach((date) => {
      BRANCHES.forEach((item) => SHIFT_OPTIONS.forEach((shift) => keys.push(reportKey(item, date, shift.id))));
    });
    return keys.map((key) => store.reports[key]).filter((item) => item?.confirmed);
  }, [store.reports, summaryStartDate, summaryEndDate]);

  const adminSummary = useMemo(() => summarizeReports(adminSummaryReports), [adminSummaryReports]);
  const adminInsights = useMemo(() => mobileAdminInsights(adminSummaryReports), [adminSummaryReports]);
  const mobileStationReports = useMemo(() => {
    const dates = datesBetween(mobileStationStartDate, mobileStationEndDate);
    const keys = [];
    dates.forEach((date) => SHIFT_OPTIONS.forEach((shift) => keys.push(reportKey(mobileStationBranch, date, shift.id))));
    return keys.map((key) => store.reports[key]).filter((item) => item?.confirmed);
  }, [store.reports, mobileStationBranch, mobileStationStartDate, mobileStationEndDate]);
  const mobileStationSummary = useMemo(() => summarizeReports(mobileStationReports), [mobileStationReports]);
  const adminDepositReports = useMemo(() => {
    const dates = datesBetween(summaryStartDate, summaryEndDate);
    const keys = [];
    dates.forEach((date) => {
      BRANCHES.forEach((item) => SHIFT_OPTIONS.forEach((shift) => keys.push(reportKey(item, date, shift.id))));
    });
    return keys.map((key) => store.reports[key]).filter((item) => item?.confirmed);
  }, [store.reports, summaryStartDate, summaryEndDate]);
  const consolidatedDeposits = useMemo(() => adminDepositReports.flatMap((item) =>
    activeDeposits(item).map((deposit) => ({ report: item, deposit }))
  ), [adminDepositReports]);
  const correctionRequests = useMemo(() => activeCorrectionRequests(store.reports), [store.reports]);
  const missingShiftActivities = useMemo(() => missingShiftActivityRows(store.reports), [store.reports]);
  const healthRows = useMemo(() => stationHealthRangeRows(store.reports, healthStartDate, healthEndDate), [store.reports, healthStartDate, healthEndDate]);
  const healthCounts = useMemo(() => stationHealthCounts(healthRows), [healthRows]);
  const depositRows = useMemo(() => depositHealthRows(store.reports, healthStartDate, healthEndDate), [store.reports, healthStartDate, healthEndDate]);
  const depositCounts = useMemo(() => statusCounts(depositRows), [depositRows]);
  const rankingReports = useMemo(() => rankingReportsForRange(store.reports, rankingRange), [store.reports, rankingRange]);
  const rankingRows = useMemo(() => stationRankingRows(rankingReports), [rankingReports]);
  const weeklyCashFlow = useMemo(() => {
    const reports = confirmedReportsBetween(store.reports, dateOffset(TODAY, -6), TODAY);
    return summarizeReports(reports).cashVariance;
  }, [store.reports]);
  const monthlyCashFlow = useMemo(() => {
    const reports = confirmedReportsBetween(store.reports, dateOffset(TODAY, -29), TODAY);
    return summarizeReports(reports).cashVariance;
  }, [store.reports]);

  function exportDailyBackup(date = selectedDate) {
    const reports = reportsForDate(store.reports, date).filter((report) => report.confirmed);
    exportDetailedReportsToExcel(reports, summarizeReports(reports), date, date);
  }

  async function refreshCashierPrices(silent = false) {
    if (!navigator.onLine || priceRefreshInFlightRef.current) {
      if (!silent && !navigator.onLine) setSyncMessage("Connect to the internet to refresh manager prices.");
      return;
    }
    priceRefreshInFlightRef.current = true;
    if (!silent) setSyncMessage("Refreshing manager prices...");
    try {
      const priceBook = await loadOnlinePriceBook(sessionToken);
      setStore((old) => ({ ...old, priceBook, reports: syncReportsWithPriceBook(old.reports, priceBook) }));
      setLastRefreshedAt(new Date().toISOString());
      if (!silent) setSyncMessage("Manager prices refreshed.");
      return priceBook;
    } catch (error) {
      if (!silent) setSyncMessage(error.message || "Unable to refresh manager prices.");
      return null;
    } finally {
      priceRefreshInFlightRef.current = false;
    }
  }

  function stageLocalReport(reportToSave) {
    localChangeVersionRef.current = nextDeviceSaveVersion(localChangeVersionRef.current);
    const reportWithSaveMeta = withClientSaveMeta(reportToSave, clientId, localChangeVersionRef.current);
    if (reportKey(reportWithSaveMeta.branch, reportWithSaveMeta.date, reportWithSaveMeta.shiftId) === reportKey(branch, activeDate, activeShiftId)) {
      activeReportRef.current = reportWithSaveMeta;
    }
    setStore((old) => ({
      ...old,
      reports: { ...old.reports, [reportKey(reportWithSaveMeta.branch, reportWithSaveMeta.date, reportWithSaveMeta.shiftId)]: reportWithSaveMeta },
    }));
    pendingLocalDraftCacheRef.current = reportWithSaveMeta;
    if (localDraftCacheTimerRef.current) window.clearTimeout(localDraftCacheTimerRef.current);
    localDraftCacheTimerRef.current = window.setTimeout(() => {
      const latestDraft = pendingLocalDraftCacheRef.current;
      localDraftCacheTimerRef.current = null;
      pendingLocalDraftCacheRef.current = null;
      if (!latestDraft) return;
      cacheLocalDraft(latestDraft);
      queueOfflineReport(latestDraft);
    }, LOCAL_DRAFT_CACHE_DEBOUNCE_MS);
    setHasUnsavedOnlineChange(true);
    setSyncMessage(navigator.onLine ? "Saved on this device. Saving online..." : "Saved on this device. Waiting for internet.");
    return reportWithSaveMeta;
  }

  function persistReport(reportToSave, operation = "save", alreadyStaged = false) {
    const reportWithSaveMeta = alreadyStaged
      ? reportToSave
      : withClientSaveMeta(reportToSave, clientId, nextDeviceSaveVersion(localChangeVersionRef.current));
    const version = Number(reportWithSaveMeta.clientSave?.version || 0);
    localChangeVersionRef.current = Math.max(localChangeVersionRef.current, version);
    if (operation === "save") {
      if (localDraftCacheTimerRef.current) window.clearTimeout(localDraftCacheTimerRef.current);
      localDraftCacheTimerRef.current = null;
      pendingLocalDraftCacheRef.current = null;
      if (!alreadyStaged) {
        setStore((old) => ({
          ...old,
          reports: { ...old.reports, [reportKey(reportWithSaveMeta.branch, reportWithSaveMeta.date, reportWithSaveMeta.shiftId)]: reportWithSaveMeta },
        }));
      }
      cacheLocalDraft(reportWithSaveMeta);
      queueOfflineReport(reportWithSaveMeta);
    }
    setHasUnsavedOnlineChange(true);
    pendingSaveCountRef.current += 1;
    setIsSavingOnline(true);
    setSyncMessage(operation === "submit" ? "Finishing pending saves and checking report..." : navigator.onLine ? "Saving online..." : "Saved on this device. Waiting for internet.");

    const performSave = async () => {
      if (!navigator.onLine) {
        if (operation === "submit") throw new Error("Connect to the internet before submitting this report.");
        return { ok: true, queued: true };
      }
      const result = await saveOnlineReport(reportWithSaveMeta, sessionToken, operation);
      if (operation === "save") removeQueuedReport(reportWithSaveMeta);
      if (result.report && localChangeVersionRef.current === version) {
        setStore((old) => ({
          ...old,
          reports: { ...old.reports, [reportKey(result.report.branch, result.report.date, result.report.shiftId)]: normalizeExistingReport(result.report) },
        }));
      }
      return result;
    };

    const savePromise = pendingSaveRef.current.catch(() => {}).then(performSave)
      .then((result) => {
        if (!result.queued && result.ok !== false && reportCompleted(result.report)) removeLocalDraft(result.report);
        if (localChangeVersionRef.current === version) {
          setHasUnsavedOnlineChange(Boolean(result.queued));
          if (!result.queued && result.ok !== false) {
            setLastOnlineSave({
              reportKey: reportKey(reportWithSaveMeta.branch, reportWithSaveMeta.date, reportWithSaveMeta.shiftId),
              at: result.report?.serverMeta?.savedAt || new Date().toISOString(),
            });
          }
          setSyncMessage(result.queued ? "Saved on this device. It will upload once when internet returns." : operation === "submit" ? `Submitted and locked. Report ID: ${result.reportId}` : "Saved online.");
        }
        return result;
      })
      .catch((error) => {
        if (operation === "save" && error.status === 423) {
          removeQueuedReport(reportWithSaveMeta);
          removeLocalDraft(reportWithSaveMeta);
          setHasUnsavedOnlineChange(Object.keys(readOfflineQueue()).length > 0);
        } else {
          setHasUnsavedOnlineChange(true);
        }
        if (error.conflict) setActiveEditors([error.editor || { actor: "Another cashier" }]);
        setSyncMessage(error.message || "Unable to save online.");
        if (operation === "submit") throw error;
        return { ok: false, error: error.message };
      })
      .finally(() => {
        pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1);
        setIsSavingOnline(pendingSaveCountRef.current > 0);
      });
    pendingSaveRef.current = savePromise;
    return savePromise;
  }

  function normalizeExistingReport(nextReport) {
    const shiftId = nextReport.shiftId || activeShiftId;
    const pricing = getEffectivePricing(store.priceBook, nextReport.branch, nextReport.date, shiftId);
    return normalizeReport(nextReport, nextReport.branch, nextReport.date, shiftId, nextReport.prices || pricing.prices || effectivePrices, {
      pricingCoverage: nextReport.pricingCoverage || pricing.pricingCoverage,
      pricingEffectiveDate: nextReport.pricingEffectiveDate || pricing.pricingEffectiveDate,
      pricingShiftId: nextReport.pricingShiftId || pricing.pricingShiftId,
    });
  }

  function saveReport(nextReport, operation = "save") {
    if (editingConflict) {
      setHasUnsavedOnlineChange(true);
      setSyncMessage("Currently being edited on another device. Please wait before saving.");
      return null;
    }

    const normalized = normalizeExistingReport(nextReport);
    if (operation === "immediate") {
      if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);
      if (pendingDraftReportRef.current) removeQueuedReport(pendingDraftReportRef.current);
      draftSaveTimerRef.current = null;
      pendingDraftReportRef.current = null;
      return persistReport(normalized, "save");
    }
    if (operation !== "save") {
      if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);
      if (pendingDraftReportRef.current) removeQueuedReport(pendingDraftReportRef.current);
      draftSaveTimerRef.current = null;
      pendingDraftReportRef.current = null;
      return persistReport(normalized, operation);
    }

    const stagedReport = stageLocalReport(normalized);
    if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);
    pendingDraftReportRef.current = stagedReport;
    draftSaveTimerRef.current = window.setTimeout(() => {
      const latestReport = pendingDraftReportRef.current;
      draftSaveTimerRef.current = null;
      pendingDraftReportRef.current = null;
      if (latestReport) persistReport(latestReport, "save", true);
    }, REPORT_SAVE_DEBOUNCE_MS);
    return Promise.resolve({ ok: true, staged: true, report: stagedReport });
  }

  function goToMissingShift(info) {
    if (!info) return;
    const entry = {
      id: uid(),
      at: new Date().toISOString(),
      role,
      actor: activeReport.cashierName || role,
      branch: info.branch,
      fromDate: info.currentDate,
      fromShiftId: info.currentShiftId,
      toDate: info.missingDate,
      toShiftId: info.missingShiftId,
      status: info.status,
    };
    saveReport({
      ...activeReport,
      missingShiftActivity: [...(activeReport.missingShiftActivity || []), entry],
    });
    setSelectedDate(info.missingDate);
    setCashierReportDateOverride(info.missingDate);
    setSelectedShiftId(info.missingShiftId);
    setCashierReportOpen(true);
  }

  function patchReport(path, value) {
    const next = clone(activeReport);
    const [section, key, subKey] = path;
    if (section === "root") next[key] = value;
    else if (section === "pumpRows") {
      next.pumpRows[key][subKey] = value;
      if (subKey === "closing") {
        next.pumpRows[key].closingEntered = value !== "";
        next.pumpRows[key].closingEntrySource = value !== "" ? "cashier" : "";
      }
    }
    else if (section === "tankRows") next.tankRows[key][subKey] = value;
    else if (section === "deductions") next.deductions[key] = value;
    else if (section === "fuelTechPayTotal") {
      next.deductions.gcash = value;
      next.deductions.card = 0;
      next.deductions.paymaya = 0;
    }
    else if (section === "coke") next.coke[key] = value;
    saveReport(next);
  }

  function updateRows(section, rows) {
    const next = clone(activeReport);
    next[section] = rows;
    saveReport(next);
  }

  function addRow(section, row) {
    const next = clone(activeReport);
    next[section] = [...next[section], row];
    saveReport(next);
  }

  function removeRow(section, id) {
    const next = clone(activeReport);
    next[section] = next[section].filter((row) => row.id !== id);
    saveReport(next);
  }

  function latestActiveReportForEdit() {
    const latest = activeReportRef.current;
    if (
      latest
      && reportKey(latest.branch, latest.date, latest.shiftId)
        === reportKey(activeReport.branch, activeReport.date, activeReport.shiftId)
    ) {
      return latest;
    }
    return activeReport;
  }

  function patchDeposit(index, key, value) {
    const next = clone(activeReport);
    next.deposits[index][key] = value;
    saveReport(next);
  }

  function addMidShiftPriceChange() {
    saveReport(addMidShiftChange(latestActiveReportForEdit(), uid()));
  }

  function patchMidShiftPriceChange(id, key, value) {
    const reportWithBasePrices = ensureMidShiftBasePrices(latestActiveReportForEdit());
    const nextReport = patchMidShiftChange(reportWithBasePrices, id, key, value);

    if (key === "effectiveTime") {
      const targetShiftId = shiftIdForEffectiveTime(value);
      if (targetShiftId && targetShiftId !== nextReport.shiftId) {
        const movedChange = nextReport.midShiftPriceChanges.find((change) => change.id === id);
        const sourceReport = removeMidShiftChange(nextReport, id);
        const targetBaseReport = ensureMidShiftBasePrices(reportForTarget(branch, nextReport.date, targetShiftId));
        const targetReport = {
          ...targetBaseReport,
          midShiftPriceChanges: [
            ...(targetBaseReport.midShiftPriceChanges || []).filter((change) => change.id !== id),
            movedChange,
          ],
        };

        setSyncMessage(`Assigning ${value} price change to ${shiftById(targetShiftId).label}...`);
        const targetSave = saveReport(targetReport, "immediate");
        if (!targetSave) return;
        targetSave.then((result) => {
          if (result?.ok === false) return null;
          return saveReport(sourceReport, "immediate");
        }).then((result) => {
          if (!result || result.ok === false) return;
          setSelectedShiftId(targetShiftId);
          setSyncMessage(`Price change assigned to ${shiftById(targetShiftId).label}.`);
        });
        return;
      }
    }

    saveReport(nextReport);
  }

  function patchMidShiftPriceReading(id, rowId, value) {
    saveReport(patchMidShiftReading(latestActiveReportForEdit(), id, rowId, value));
  }

  function removeMidShiftPriceChange(id) {
    saveReport(removeMidShiftChange(latestActiveReportForEdit(), id));
  }

  function confirmMidShiftPriceChange(id) {
    const latestReport = latestActiveReportForEdit();
    const change = (latestReport.midShiftPriceChanges || []).find((item) => item.id === id);
    if (!change?.effectiveTime || n(change.newPrice) <= 0) {
      setSyncMessage("Enter the effective time and new mid-shift price before confirming.");
      return;
    }
    const matchingRows = (latestReport.pumpRows || []).filter((row) => row.product === change.product);
    if (matchingRows.some((row) => n(midShiftReadingValue(change, row)) <= 0)) {
      setSyncMessage(`Complete every ${change.product} price-change pump reading before confirming.`);
      return;
    }
    const confirmedReport = {
      ...latestReport,
      midShiftPriceChanges: latestReport.midShiftPriceChanges.map((item) =>
        item.id === id ? { ...item, confirmedAt: new Date().toISOString() } : item
      ),
    };
    const dailyPricing = getEffectiveDailyPricing(store.priceBook, branch, latestReport.date);
    const nextDailyPrices = { ...dailyPricing.prices, [change.product]: committedManagerPrice(change.newPrice) };
    const savePromise = saveReport(confirmedReport, "immediate");
    if (!savePromise) return;
    setSyncMessage(`Confirming ${change.product} mid-shift price...`);
    savePromise.then(async (result) => {
      if (result?.ok === false) return;
      setIsSavingOnline(true);
      setSyncMessage(`Applying ${change.product} as the new daily price...`);
      try {
        await saveOnlinePrices(branch, latestReport.date, "Daily", "daily", nextDailyPrices, sessionToken);
        setStore((old) => ({
          ...old,
          priceBook: {
            ...old.priceBook,
            [branch]: {
              ...(old.priceBook[branch] || {}),
              [dailyPriceKey(latestReport.date)]: nextDailyPrices,
            },
          },
        }));
        setSelectedDate(latestReport.date);
        setPricingCoverage("Daily");
        setHasUnsavedOnlineChange(false);
        setSyncMessage(`${change.product} mid-shift price confirmed and applied as the new daily price.`);
      } catch (error) {
        setHasUnsavedOnlineChange(true);
        setSyncMessage(error.message || `Mid-shift entry saved, but ${change.product} could not be applied to the daily price.`);
      } finally {
        setIsSavingOnline(false);
      }
    });
  }

  function addDeposit() {
    addRow("deposits", { id: uid(), bank: "", reference: "", amount: 0, verified: false, removalRequested: false, removal_requested: false, removed: false });
  }

  function saveDailyBankDeposit() {
    const amount = n(depositDraft.amount);
    const targetShiftIds = depositCoverageShiftIds(depositCoverage);

    if (amount <= 0) {
      setSyncMessage("Please enter the bank deposit amount.");
      return;
    }

    if (!depositDate || !depositSalesDate) {
      setSyncMessage("Please select the deposit date and sales date covered.");
      return;
    }

    const targetReports = targetShiftIds.map((shiftId) => reportForTarget(branch, depositSalesDate, shiftId));
    const expectedValues = targetReports.map((report) => Math.max(0, n(compute(report).expectedCash)));
    const expectedTotal = expectedValues.reduce((sum, value) => sum + value, 0);
    const groupId = uid();
    let allocatedSoFar = 0;

    targetReports.forEach((targetReport, index) => {
      const rawAllocation = expectedTotal > 0
        ? amount * (expectedValues[index] / expectedTotal)
        : amount / targetReports.length;
      const allocation = index === targetReports.length - 1
        ? Math.round((amount - allocatedSoFar) * 100) / 100
        : Math.round(rawAllocation * 100) / 100;
      allocatedSoFar += allocation;

      const deposit = {
        id: uid(),
        groupId,
        bank: depositDraft.bank || "",
        reference: depositDraft.reference || "",
        amount: allocation,
        totalDepositAmount: amount,
        depositDate,
        salesDateCovered: depositSalesDate,
        coverage: depositCoverage,
        coverageLabel: depositCoverageLabel(depositCoverage),
        coveredShiftIds: targetShiftIds,
        verified: false,
        removalRequested: false,
        removal_requested: false,
        removed: false,
      };

      persistReport(normalizeExistingReport({
        ...targetReport,
        deposits: [...(targetReport.deposits || []), deposit],
      }));
    });

    setDepositDraft({ bank: "", reference: "", amount: 0 });
    setSyncMessage(`Daily bank deposit saved for ${branch}, ${depositSalesDate}, ${depositCoverageLabel(depositCoverage)}.`);
  }

  async function requestDateCorrection() {
    if (!correctionDraft.date || !correctionDraft.shiftId) {
      setSyncMessage("Please select the report date and shift for correction.");
      return;
    }

    if (!correctionDraft.reason.trim()) {
      setSyncMessage("Please enter the reason for the correction request.");
      return;
    }

    const targetReport = reportForTarget(branch, correctionDraft.date, correctionDraft.shiftId);
    const baseRequest = {
      id: correctionRequest(targetReport).id || uid(),
      status: "pending",
      branch,
      reportDate: correctionDraft.date,
      shiftId: correctionDraft.shiftId,
      reason: correctionDraft.reason.trim(),
      requestedAt: new Date().toLocaleString(),
      approvedAt: "",
      rejectedAt: "",
      expiresAt: "",
      completedAt: "",
    };
    const requestedDate = correctionDraft.date;
    const requestedShiftId = correctionDraft.shiftId;
    if (!navigator.onLine) {
      setSyncMessage("Connect to the internet before sending a correction request.");
      return;
    }

    setIsSavingOnline(true);
    setSyncMessage("Sending correction request to admin...");
    try {
      await pendingSaveRef.current.catch(() => {});
      const result = await saveOnlineReport(normalizeExistingReport({
        ...targetReport,
        correctionRequest: baseRequest,
      }), sessionToken, "request-correction");
      if (result.report) {
        setStore((old) => ({
          ...old,
          reports: {
            ...old.reports,
            [reportKey(result.report.branch, result.report.date, result.report.shiftId)]: normalizeExistingReport(result.report),
          },
        }));
      }
      setCorrectionDraft((old) => ({ ...old, reason: "" }));
      setSyncMessage(`Correction request saved online for ${branch}, ${requestedDate}, ${shiftById(requestedShiftId).label}.`);
    } catch (error) {
      setSyncMessage(error.message || "Unable to send the correction request.");
    } finally {
      setIsSavingOnline(false);
    }
  }

  function confirmStartingOpening() {
    if (!hasCompleteBaselineOpening(activeReport)) {
      setSyncMessage("Please complete all pump opening readings and underground tank opening inventory before confirming the starting opening.");
      return;
    }

    saveReport({
      ...activeReport,
      pumpRows: activeReport.pumpRows.map((row) => ({
        ...row,
        closing: n(row.opening),
        closingEntered: true,
        closingEntrySource: "baseline",
      })),
      tankRows: activeReport.tankRows.map((row) => ({
        ...row,
        actualDip: n(row.opening),
      })),
      coke: {
        ...(activeReport.coke || {}),
        ending: n(activeReport.coke?.beginning),
      },
      baselineConfirmed: true,
      baselineReport: true,
      baselineConfirmedAt: new Date().toLocaleString(),
      baselineReady: true,
      baselineMissing: false,
      baselineMessage: "",
    }, "immediate");
  }

  async function confirmReport() {
    setSubmitReportError("");
    if (activeReport.confirmed) {
      setSyncMessage(`This report is locked${activeReport.serverMeta?.reportId ? ` as ${activeReport.serverMeta.reportId}` : ""}. Request an admin correction to change it.`);
      return;
    }

    if (activeCriticalWarnings.length > 0) {
      setSyncMessage(activeCriticalWarnings[0]);
      return;
    }

    const priceWarning = activeWarnings.find((warning) => warning.includes("pump price is missing"));
    const blockingWarning = activeWarnings.find((warning) =>
      warning.includes("No previous closing")
      || warning.includes("opening is missing")
      || warning.includes("Gross sales is unusually high")
    );
    if (blockingWarning) {
      setSyncMessage(blockingWarning);
      return;
    }

    if (priceWarning) {
      const latestPriceBook = await refreshCashierPrices(true);
      if (!latestPriceBook) {
        setSyncMessage("Unable to load manager prices. Check the internet connection, then press Confirm Report again.");
        return;
      }
      const latestPricing = getEffectivePricing(latestPriceBook, activeReport.branch, activeReport.date, activeReport.shiftId);
      const stillMissing = (activeReport.pumpRows || []).some((row) =>
        pumpLitersSold(row) > 0 && n(latestPricing.prices[row.product]) <= 0
      );
      if (stillMissing) {
        setSyncMessage(`${priceWarning} Ask the manager to confirm prices for this station, date, and shift.`);
        return;
      }
      const pricedReport = {
        ...activeReport,
        prices: { ...(activeReport.prices || {}), ...latestPricing.prices },
        pricingCoverage: latestPricing.pricingCoverage,
        pricingEffectiveDate: latestPricing.pricingEffectiveDate,
        pricingShiftId: latestPricing.pricingShiftId,
      };
      setStore((old) => ({
        ...old,
        priceBook: latestPriceBook,
        reports: {
          ...old.reports,
          [reportKey(pricedReport.branch, pricedReport.date, pricedReport.shiftId)]: pricedReport,
        },
      }));
      cacheLocalDraft(pricedReport);
      setSyncMessage("Latest manager prices applied. Opening report confirmation...");
      window.setTimeout(() => setShowReportConfirm(true), 0);
      return;
    }

    setShowReportConfirm(true);
  }

  function submitConfirmedReport(extra = {}) {
    return saveReport({
      ...activeReport,
      confirmed: true,
      confirmedAt: new Date().toLocaleString(),
      cashVarianceReason: extra.cashVarianceReason ?? activeReport.cashVarianceReason ?? "",
      cashVarianceConfirmedAt: extra.cashVarianceReason ? new Date().toLocaleString() : activeReport.cashVarianceConfirmedAt ?? "",
      reopenStartingOpening: false,
      correctionRequest: correctionRequest(activeReport).status === "approved"
        ? { ...correctionRequest(activeReport), status: "completed", completedAt: new Date().toLocaleString() }
        : activeReport.correctionRequest,
      undoReason: "",
      undoReasonAt: "",
    }, "submit");
  }

  function confirmSubmitReport() {
    setShowReportConfirm(false);
    setSubmitReportError("");
    setIsSubmittingReport(true);
    Promise.resolve(submitConfirmedReport())
      .catch((error) => setSubmitReportError(error.message || "The report could not be submitted. Please review the required fields and try again."))
      .finally(() => setIsSubmittingReport(false));
  }

  function approveCorrectionRequest(sourceReport) {
    const request = correctionRequest(sourceReport);
    persistReport(normalizeExistingReport({
      ...sourceReport,
      confirmed: false,
      confirmedAt: "",
      undoReason: "Admin approved date correction request.",
      undoReasonAt: new Date().toLocaleString(),
      correctionRequest: approvedCorrectionPayload(request),
    }));
    setSyncMessage(`Approved correction for ${sourceReport.branch}, ${sourceReport.date}, ${shiftById(sourceReport.shiftId).label}.`);
  }

  function rejectCorrectionRequest(sourceReport) {
    const request = correctionRequest(sourceReport);
    persistReport(normalizeExistingReport({
      ...sourceReport,
      correctionRequest: {
        ...request,
        status: "rejected",
        rejectedAt: new Date().toLocaleString(),
        expiresAt: "",
      },
    }));
    setSyncMessage(`Rejected correction for ${sourceReport.branch}, ${sourceReport.date}, ${shiftById(sourceReport.shiftId).label}.`);
  }

  function verifyDeposit(id, sourceReport = activeReport) {
    const next = clone(sourceReport);
    const current = next.deposits.find((deposit) => deposit.id === id);
    if (current?.verified && !window.confirm("This bank deposit has already been verified. Are you sure you want to undo the verification?")) {
      return;
    }
    next.deposits = next.deposits.map((deposit) =>
      deposit.id === id ? { ...deposit, verified: !deposit.verified } : deposit
    );
    persistReport(normalizeExistingReport(next));
  }

  async function approveDepositVerification(id, sourceReport) {
    const result = await apiPost("/api/deposits/verify", {
      branch: sourceReport.branch,
      reportDate: sourceReport.date,
      shiftId: sourceReport.shiftId,
      depositId: id,
    }, sessionToken);
    if (result.report) {
      const normalized = normalizeExistingReport(result.report);
      setStore((old) => ({
        ...old,
        reports: {
          ...old.reports,
          [reportKey(normalized.branch, normalized.date, normalized.shiftId)]: normalized,
        },
      }));
    }
    return result;
  }

  async function reviewDepositRemovalRequest(id, sourceReport, decision) {
    const result = await apiPost("/api/deposits/removal", {
      branch: sourceReport.branch,
      reportDate: sourceReport.date,
      shiftId: sourceReport.shiftId,
      depositId: id,
      decision,
    }, sessionToken);
    if (result.report) {
      const normalized = normalizeExistingReport(result.report);
      setStore((old) => ({
        ...old,
        reports: {
          ...old.reports,
          [reportKey(normalized.branch, normalized.date, normalized.shiftId)]: normalized,
        },
      }));
    }
    return result;
  }

  function requestDepositRemoval(id) {
    requestDepositRemovalFromReport(id, activeReport);
  }

  function requestDepositRemovalFromReport(id, sourceReport = activeReport, requestType = "removal") {
    const next = clone(sourceReport);
    next.deposits = next.deposits.map((deposit) =>
      deposit.id === id ? { ...deposit, removalRequested: true, removal_requested: true, removalRequestType: requestType } : deposit
    );
    persistReport(normalizeExistingReport(next));
  }

  function approveDepositRemoval(id, sourceReport = activeReport) {
    const next = clone(sourceReport);
    next.deposits = next.deposits.map((deposit) =>
      deposit.id === id ? { ...deposit, removalRequested: false, removal_requested: false, removalRequestType: "", removed: true } : deposit
    );
    persistReport(normalizeExistingReport(next));
  }

  function rejectDepositRemoval(id, sourceReport = activeReport) {
    const next = clone(sourceReport);
    next.deposits = next.deposits.map((deposit) =>
      deposit.id === id ? { ...deposit, removalRequested: false, removal_requested: false, removalRequestType: "" } : deposit
    );
    persistReport(normalizeExistingReport(next));
  }

  function patchEffectivePrice(product, value) {
    localChangeVersionRef.current = nextDeviceSaveVersion(localChangeVersionRef.current);
    const nextPrices = { ...defaultPrices(), ...displayedManagerPrices, [product]: value };
    const priceKey = pricingCoverage === "Shift" ? shiftPriceKey(selectedDate, pricingShiftId) : dailyPriceKey(selectedDate);
    setStore((old) => {
      const priceBook = {
        ...old.priceBook,
        [branch]: {
          ...(old.priceBook[branch] || {}),
          [priceKey]: nextPrices,
        },
      };
      return { ...old, priceBook, reports: syncReportsWithPriceBook(old.reports, priceBook) };
    });
    setHasUnsavedOnlineChange(true);
    setIsSavingOnline(true);
    setSyncMessage(`Saving ${pricingCoverage.toLowerCase()} prices online...`);
    return saveOnlinePrices(branch, selectedDate, pricingCoverage, pricingShiftId, nextPrices, sessionToken)
      .then(() => {
        setHasUnsavedOnlineChange(false);
        setSyncMessage(`${pricingCoverage} prices saved online.`);
      })
      .catch((error) => {
        setHasUnsavedOnlineChange(true);
        setSyncMessage(error.message || `Unable to save ${pricingCoverage.toLowerCase()} prices online.`);
      })
      .finally(() => {
        setIsSavingOnline(false);
      });
  }

  function patchFuelDeliveryCosts({ deliveryBranch = branch, deliveryDate = selectedDate, deliveryShiftId = selectedShiftId, costs = {} }) {
    localChangeVersionRef.current = nextDeviceSaveVersion(localChangeVersionRef.current);
    const basePrices = getEffectiveDailyPricing(store.priceBook, deliveryBranch, deliveryDate).prices;
    const deliveryKey = reportKey(deliveryBranch, deliveryDate, deliveryShiftId);
    const confirmedAt = new Date().toISOString();
    const oldMeta = basePrices.fuelDeliveryCostMeta || {};
    const nextPrices = {
      ...defaultPrices(),
      ...defaultFuelCosts(),
      ...basePrices,
      ...costs,
      fuelDeliveryCostMeta: {
        ...oldMeta,
        station: deliveryBranch,
        dateDelivered: deliveryDate,
        shiftDelivered: deliveryShiftId,
        confirmedAt,
        confirmedDeliveries: {
          ...(oldMeta.confirmedDeliveries || {}),
          [deliveryKey]: { station: deliveryBranch, dateDelivered: deliveryDate, shiftDelivered: deliveryShiftId, confirmedAt },
        },
      },
    };
    const priceKey = dailyPriceKey(deliveryDate);
    setStore((old) => ({
      ...old,
      priceBook: {
        ...old.priceBook,
        [deliveryBranch]: {
          ...(old.priceBook[deliveryBranch] || {}),
          [priceKey]: nextPrices,
        },
      },
    }));
    setHasUnsavedOnlineChange(true);
    setIsSavingOnline(true);
    setSyncMessage("Saving fuel delivery costs online...");
    return saveOnlinePrices(deliveryBranch, deliveryDate, "Daily", "daily", nextPrices, sessionToken)
      .then(() => {
        setHasUnsavedOnlineChange(false);
        setSyncMessage(`Fuel delivery costs saved online for ${deliveryBranch}, ${deliveryDate}, ${shiftById(deliveryShiftId).label}.`);
      })
      .catch((error) => {
        setHasUnsavedOnlineChange(true);
        setSyncMessage(error.message || "Unable to save fuel delivery costs online.");
        throw error;
      })
      .finally(() => {
        setIsSavingOnline(false);
      });
  }

  function confirmDailyPrices() {
    setStore((old) => ({ ...old, reports: syncReportsWithPriceBook(old.reports, old.priceBook) }));
    setSyncMessage(`${pricingCoverage} prices confirmed for ${selectedDate}${pricingCoverage === "Shift" ? `, ${shiftById(pricingShiftId).label}` : ""}. Reports now use the matching price history.`);
  }

  async function unlock() {
    if (authLoading) return;

    setAuthLoading(true);
    setAuthMessage("");
    try {
      const result = await verifyLoginPin({ role, branch, pin });
      if (!result.ok) {
        setAuthMessage(role === "Admin" ? "Invalid admin PIN." : role === "Approver" ? "Invalid approver PIN." : "Invalid branch PIN.");
        return;
      }

      setSessionToken(result.token || "");

      if (role === "Admin") {
        setAdminAccess(true);
        setAdminSessionExpiresAt(Number(result.expiresAt) || 0);
      }

      if (role === "Approver") {
        setApproverAccess(true);
      }

      if (role === "Cashier") {
        setCashierAccess((old) => ({ ...old, [branch]: true }));
        cacheCashierSession(branch);
      }

      if (role === "Manager") {
        setManagerAccess((old) => ({ ...old, [branch]: true }));
      }

      setPin("");
      return;
    } catch (error) {
      setAuthMessage(error.message || "Unable to verify PIN.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    setAuthMessage("");
    try {
      if (role === "Cashier" && localDraftCacheTimerRef.current) {
        window.clearTimeout(localDraftCacheTimerRef.current);
        localDraftCacheTimerRef.current = null;
        const latestLocalDraft = pendingLocalDraftCacheRef.current;
        pendingLocalDraftCacheRef.current = null;
        if (latestLocalDraft) {
          cacheLocalDraft(latestLocalDraft);
          queueOfflineReport(latestLocalDraft);
        }
      }
      if (role === "Cashier" && draftSaveTimerRef.current) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
        const latestDraft = pendingDraftReportRef.current;
        pendingDraftReportRef.current = null;
        if (latestDraft) await persistReport(latestDraft, "save", true);
      }
      if (role === "Cashier") await pendingSaveRef.current.catch(() => {});
      if (role === "Cashier" && cashierReportOpen && sessionToken) {
        await requestReportLease({ branch, date: activeDate, shiftId: activeShiftId, clientId, actor: "Cashier", action: "release", sessionToken }).catch(() => {});
      }
      await endLoginSession();
      window.sessionStorage.removeItem(CASHIER_SESSION_CACHE_KEY);
      setSessionToken("");
      setCashierAccess({});
      setManagerAccess({});
      setAdminAccess(false);
      setAdminSessionExpiresAt(0);
      setApproverAccess(false);
      setCashierReportOpen(false);
      setCashierReportDateOverride("");
      setPin("");
      setSyncMessage("Logged out safely. Unfinished drafts remain saved on this device.");
    } catch (error) {
      setAuthMessage(error.message || "Unable to log out safely.");
    }
  }

  if (!role) {
    return (
      <main className="app">
        <div className="container">
          <header className="hero">
            <div>
              <div className="brand">FUELTECH ACCOUNTING</div>
              <h1>FuelTech Accounting</h1>
              <p>Official online branch reporting for cashier reports, manager fuel prices, bank deposits, and admin verification.</p>
            </div>
            <div className="hero-card">
              <button type="button" className="primary" onClick={() => openRole("/cashier")}>Open Cashier</button>
              <button type="button" className="primary" onClick={() => openRole("/manager")}>Open Manager</button>
              <Card title="Database" value={syncMessage} note={formatRefreshTime(lastRefreshedAt)} />
            </div>
          </header>
        </div>
      </main>
    );
  }

  const isAdminLogin = role === "Admin" && !accessAllowed;
  const isApproverLogin = role === "Approver" && !accessAllowed;
  const isPrivateLogin = isAdminLogin || isApproverLogin;
  const showAppHero = !["Admin", "Approver"].includes(role);
  const cashierInitialLoadPending = role === "Cashier" && accessAllowed && !initialLoadFinished;
  const cashierInitialLoadFailed = role === "Cashier" && accessAllowed && initialLoadFinished && Boolean(initialLoadError);

  return (
    <main className={`app ${role === "Admin" && accessAllowed ? "admin-app" : ""} ${role === "Approver" && accessAllowed ? "approver-app" : ""} ${isPrivateLogin ? "admin-login-app" : ""}`.trim()}>
      <div className="container">
        {showAppHero && (
          <header className="hero">
            <div>
              <div className="brand">FUELTECH ACCOUNTING</div>
              <h1>FuelTech Accounting</h1>
            </div>
            <div className="hero-card">
              <Field label="Branch"><SelectInput value={branch} onChange={(value) => { setBranch(value); if (role === "Cashier") { setCashierReportOpen(false); setCashierReportDateOverride(""); } }} options={BRANCHES} /></Field>
              {role === "Admin" && (
                <Field label="Report Date"><TextInput type="date" value={selectedDate} onChange={setSelectedDate} /></Field>
              )}
              {role === "Admin" && (
                <Field label="Report Shift"><SelectInput value={selectedShiftId} onChange={setSelectedShiftId} options={SHIFT_OPTIONS.map((shift) => ({ value: shift.id, label: shift.label }))} /></Field>
              )}
              {role === "Cashier" && (
                <Card title="Report Date" value={cashierReportDateDisplay({
                  accessAllowed,
                  currentDate,
                  initialLoadFinished,
                  initialLoadError,
                  activeDate,
                })} />
              )}
              <Card title="Live Updates" value="On database change" note={formatRefreshTime(lastRefreshedAt)} />
              {accessAllowed && role === "Cashier" && <button type="button" className="secondary" onClick={logout}>Log Out</button>}
            </div>
          </header>
        )}

        {accessAllowed && role === "Cashier" && (
          <CashierSaveStatus status={cashierSaveStatus} />
        )}

        {saveWarning && role !== "Cashier" && (
          <WarningBanner>
            {saveWarningText}
          </WarningBanner>
        )}

        {!accessAllowed ? (
          role === "Admin" || role === "Approver" ? (
            <div className="admin-login-screen">
              <div className="admin-login-top">
                <span>FUELTECH ACCOUNTING</span>
                <h1>{role === "Approver" ? "Bank Approver Login" : "Admin Login"}</h1>
                <p>{role === "Approver" ? "Restricted access for bank-deposit approval." : "Private owner summary access."}</p>
              </div>
              <div className="admin-login-form">
                <Field label={role === "Approver" ? "Approver PIN" : "Admin PIN"}><TextInput value={pin} onChange={setPin} type="password" /></Field>
                <button type="button" className="admin-login-button" onClick={unlock} disabled={authLoading}>{authLoading ? "Checking..." : role === "Approver" ? "Open Bank Verification" : "Open Dashboard"}</button>
                {authMessage && <p className="admin-login-error">{authMessage}</p>}
                <small>{role === "Approver" ? "This login can only approve bank deposits." : "Secure access for admin only."}</small>
              </div>
            </div>
          ) : (
          <Section title={`${role} Branch Access`}>
            <div className="pin-box">
              <Card title="Selected Branch" value={branch} tone="dark" />
              <Field label={`${role} PIN`}><BranchPinInput value={pin} onChange={(value) => { setPin(value); setAuthMessage(""); }} onSubmit={unlock} /></Field>
              <button type="button" className="primary" onClick={unlock} disabled={authLoading}>{authLoading ? "Checking..." : "Proceed"}</button>
              {authMessage && <p className="error">{authMessage}</p>}
            </div>
          </Section>
          )
        ) : (
          <>
            {role === "Cashier" && (cashierInitialLoadPending
              ? <Section title="Loading Saved Reports"><p className="neutral">Checking confirmed shifts and saved drafts online...</p></Section>
              : cashierInitialLoadFailed
              ? <Section title="Unable to Load Saved Reports">
                  <p className="error">{initialLoadError}</p>
                  <p className="neutral">No report status is being shown because the online records could not be verified.</p>
                  <button type="button" className="secondary" onClick={() => window.location.reload()}>Try Again</button>
                </Section>
              : cashierReportOpen
              ? <CashierPage report={activeReport} result={activeResult} warnings={activeWarnings} criticalWarnings={activeCriticalWarnings} missingPreviousShift={activeMissingPreviousShift} onGoToMissingShift={goToMissingShift} editingConflict={editingConflict} isSubmittingReport={isSubmittingReport} activeEditors={activeEditors} currentShift={{ date: activeDate, label: displayShiftLabel(branch, activeDate, activeShiftId) }} patchReport={patchReport} updateRows={updateRows} addRow={addRow} removeRow={removeRow} confirmStartingOpening={confirmStartingOpening} confirmReport={confirmReport} onBackToShifts={() => { setCashierReportOpen(false); setCashierReportDateOverride(""); }} />
              : <CashierShiftDashboard branch={branch} date={activeDate} reports={store.reports} openingDate={GLOBAL_OPENING_DATE} openingShiftId={GLOBAL_OPENING_SHIFT_ID} onOpenOpening={(date, shiftId) => { setCashierReportDateOverride(date); setSelectedShiftId(shiftId); setCashierReportOpen(true); }} onSelect={(shiftId) => { setCashierReportDateOverride(activeDate); setSelectedShiftId(shiftId); setCashierReportOpen(true); }} correctionDraft={correctionDraft} setCorrectionDraft={setCorrectionDraft} requestDateCorrection={requestDateCorrection} correctionReport={correctionCardReport} onOpenCorrection={(report) => { setCashierReportDateOverride(report.date); setSelectedShiftId(report.shiftId); setCashierReportOpen(true); }} />)}
            {role === "Manager" && <ManagerPage branch={branch} selectedDate={selectedDate} setSelectedDate={setSelectedDate} prices={displayedManagerPrices} pricingCoverage={pricingCoverage} setPricingCoverage={setPricingCoverage} pricingShiftId={pricingShiftId} setPricingShiftId={setPricingShiftId} report={activeReport} result={activeResult} patchEffectivePrice={patchEffectivePrice} confirmDailyPrices={confirmDailyPrices} patchDeposit={patchDeposit} addDeposit={addDeposit} requestDepositRemoval={requestDepositRemoval} depositDate={depositDate} setDepositDate={setDepositDate} depositSalesDate={depositSalesDate} setDepositSalesDate={setDepositSalesDate} depositHistoryFrom={depositHistoryFrom} setDepositHistoryFrom={setDepositHistoryFrom} depositHistoryTo={depositHistoryTo} setDepositHistoryTo={setDepositHistoryTo} depositCoverage={depositCoverage} setDepositCoverage={setDepositCoverage} depositDraft={depositDraft} setDepositDraft={setDepositDraft} depositShiftIds={depositShiftIds} managerDepositRows={managerDepositRows} saveDailyBankDeposit={saveDailyBankDeposit} requestDepositRemovalFromReport={requestDepositRemovalFromReport} addMidShiftPriceChange={addMidShiftPriceChange} patchMidShiftPriceChange={patchMidShiftPriceChange} patchMidShiftPriceReading={patchMidShiftPriceReading} confirmMidShiftPriceChange={confirmMidShiftPriceChange} removeMidShiftPriceChange={removeMidShiftPriceChange} />}
            {role === "Approver" && (!initialLoadFinished
              ? <Section title="Loading Bank Verifications"><p className="neutral">Loading deposits from all stations...</p></Section>
              : initialLoadError
              ? <Section title="Unable to Load Bank Verifications">
                  <p className="error">{initialLoadError}</p>
                  <button type="button" className="secondary" onClick={() => window.location.reload()}>Try Again</button>
                </Section>
              : <ApproverPage allReports={store.reports} consolidatedDeposits={consolidatedDeposits} startDate={summaryStartDate} setStartDate={setSummaryStartDate} endDate={summaryEndDate} setEndDate={setSummaryEndDate} approveDepositVerification={approveDepositVerification} reviewDepositRemovalRequest={reviewDepositRemovalRequest} lastRefreshedAt={lastRefreshedAt} logout={logout} />)}
            {role === "Admin" && <AdminPage logout={logout} sessionToken={sessionToken} branch={branch} setBranch={setBranch} selectedDate={selectedDate} setSelectedDate={setSelectedDate} selectedShiftId={selectedShiftId} setSelectedShiftId={setSelectedShiftId} lastRefreshedAt={lastRefreshedAt} report={activeReport} result={activeResult} priceBook={store.priceBook} allReports={store.reports} patchFuelDeliveryCosts={patchFuelDeliveryCosts} verifyDeposit={verifyDeposit} approveDepositRemoval={approveDepositRemoval} rejectDepositRemoval={rejectDepositRemoval} correctionRequests={correctionRequests} missingShiftActivities={missingShiftActivities} approveCorrectionRequest={approveCorrectionRequest} rejectCorrectionRequest={rejectCorrectionRequest} summaryStartDate={summaryStartDate} setSummaryStartDate={setSummaryStartDate} summaryEndDate={summaryEndDate} setSummaryEndDate={setSummaryEndDate} adminSummaryReports={adminSummaryReports} adminSummary={adminSummary} adminInsights={adminInsights} mobileStationBranch={mobileStationBranch} setMobileStationBranch={setMobileStationBranch} mobileStationStartDate={mobileStationStartDate} setMobileStationStartDate={setMobileStationStartDate} mobileStationEndDate={mobileStationEndDate} setMobileStationEndDate={setMobileStationEndDate} mobileStationSummary={mobileStationSummary} consolidatedDeposits={consolidatedDeposits} exportDailyBackup={exportDailyBackup} systemHealth={systemHealth} healthStartDate={healthStartDate} setHealthStartDate={setHealthStartDate} healthEndDate={healthEndDate} setHealthEndDate={setHealthEndDate} healthRows={healthRows} healthCounts={healthCounts} depositRows={depositRows} depositCounts={depositCounts} rankingRange={rankingRange} setRankingRange={setRankingRange} rankingRows={rankingRows} rankingReportCount={rankingReports.length} weeklyCashFlow={weeklyCashFlow} monthlyCashFlow={monthlyCashFlow} />}
            {showReportConfirm && (
              <ConfirmReportDialog
                report={activeReport}
                result={activeResult}
                onGoBack={() => setShowReportConfirm(false)}
                onConfirm={confirmSubmitReport}
                isSubmitting={isSubmittingReport}
              />
            )}
            {role === "Cashier" && submitReportError && (
              <ReportSubmitErrorDialog
                message={submitReportError}
                onClose={() => setSubmitReportError("")}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}

function BaselineOpeningSection({ report, patchReport, confirmStartingOpening }) {
  return (
    <Section title="Opening Setup - Starting Readings">
      <div className="warning-box">
        Enter the readings at the start of today&apos;s current shift, before recording sales. These become Previous Shift Closing for this fresh shift. This is not a previous-day report.
        If a pump or tank is genuinely at zero, type 0 so the system knows it was checked.
      </div>
      <Table headers={["Pump", "Nozzle", "Starting Reading (becomes Previous Shift Closing)"]} minWidth="720px">
        {report.pumpRows.map((row, index) => (
          <tr key={row.id}>
            <td>{row.pump}</td>
            <td>{row.nozzle}</td>
            <td><NumberInput ghostZero value={row.opening} onChange={(value) => patchReport(["pumpRows", index, "opening"], value)} /></td>
          </tr>
        ))}
      </Table>
      <Table headers={["Tank", "First Opening Underground Tank"]} minWidth="560px">
        {report.tankRows.map((row, index) => (
          <tr key={row.id}>
            <td>{row.tank}</td>
            <td><NumberInput ghostZero value={row.opening} onChange={(value) => patchReport(["tankRows", index, "opening"], value)} /></td>
          </tr>
        ))}
      </Table>
      <div className="grid four form-space">
        <Field label="Coke Beginning"><NumberInput ghostZero value={report.coke.beginning} onChange={(value) => patchReport(["coke", "beginning"], value)} /></Field>
      </div>
      <button type="button" className="confirm-button" onClick={confirmStartingOpening}>Confirm Opening Setup</button>
    </Section>
  );
}

function ConfirmReportDialog({ report, result, onGoBack, onConfirm, isSubmitting }) {
  const reviewFlags = reportReviewFlags(report, result);
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-report-title">
      <div className="modal-panel">
        <div className="modal-header">
          <span>Confirm Report</span>
          <h2 id="confirm-report-title">Submit this shift report?</h2>
          <p>Please confirm only when the cashier is ready to send this report to admin.</p>
        </div>
        <div className="modal-hints neutral">
          <b>Report summary</b>
          <ul>
            <li>{report.branch} - {shiftById(report.shiftId).label}</li>
            <li>Total liters: {liter(result.totalLiters)}</li>
            <li>Status after submit: {reviewFlags.length ? "Submitted - Check Required" : "Submitted"}</li>
          </ul>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onGoBack} disabled={isSubmitting}>Go Back</button>
          <button type="button" className="confirm-button" onClick={onConfirm} disabled={isSubmitting}>{isSubmitting ? "Submitting Report..." : "Confirm Report"}</button>
        </div>
      </div>
    </div>
  );
}

function ReportSubmitErrorDialog({ message, onClose }) {
  const shouldReload = /newer|another device|restarted|older draft|changed while|reload/i.test(message);
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="submit-error-title">
      <div className="modal-panel">
        <div className="modal-header">
          <span>Report Not Submitted</span>
          <h2 id="submit-error-title">Report Not Submitted</h2>
          <p>{message}</p>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>Close and Review</button>
          {shouldReload && <button type="button" className="confirm-button" onClick={() => window.location.reload()}>Reload Latest Report</button>}
        </div>
      </div>
    </div>
  );
}

function CashierShiftDashboard({ branch, date, reports, openingDate, openingShiftId, onOpenOpening, onSelect, correctionDraft, setCorrectionDraft, requestDateCorrection, correctionReport, onOpenCorrection }) {
  const shifts = SHIFT_OPTIONS.map((shift) => ({ shift, report: reports[reportKey(branch, date, shift.id)] }));
  const openingComplete = Object.values(reports).some((report) => report?.branch === branch && openingSetupCompleted(report));
  const nextShiftId = openingComplete ? shifts.find(({ report }) => !reportCompleted(report))?.shift.id : "";
  const submittedCount = shifts.filter(({ report }) => reportCompleted(report)).length;
  const correction = correctionRequest(correctionReport);
  const correctionApproved = isActiveCorrectionApproval(correctionReport);

  return (
    <section className="cashier-shift-dashboard" aria-labelledby="cashier-shifts-title">
      <div className="cashier-shift-heading">
        <div>
          <span>Cashier Reports</span>
          <h2 id="cashier-shifts-title">Choose a shift</h2>
          <p>{branch} - {date}</p>
        </div>
        <strong>{submittedCount} of 3 submitted</strong>
      </div>
      <button type="button" className={`cashier-opening-card ${openingComplete ? "complete" : "required"}`} onClick={() => !openingComplete && onOpenOpening(openingDate, openingShiftId)}>
        <span>
          <b>Opening Setup</b>
          <small>{openingDate} - {shiftById(openingShiftId).label}. These readings become Previous Shift Closing for the first reporting shift.</small>
        </span>
        <span className={`cashier-shift-status ${openingComplete ? "submitted" : "missing"}`}>{openingComplete ? "Complete" : "Required"}</span>
        <strong>{openingComplete ? "Opening setup confirmed" : "Start opening setup"}</strong>
      </button>
      <div className="cashier-shift-grid">
        {shifts.map(({ shift, report }, index) => {
          const status = reportCompleted(report) ? "submitted" : hasMeaningfulDraftEntries(report) ? "draft" : "missing";
          const isNext = shift.id === nextShiftId;
          return (
            <button type="button" className={`cashier-shift-card ${isNext ? "next" : ""}`} key={shift.id} onClick={() => onSelect(shift.id)} disabled={!openingComplete}>
              <span className="cashier-shift-index">0{index + 1}</span>
              <span className="cashier-shift-card-top">
                <b>Shift {index + 1}</b>
                <span className={`cashier-shift-status ${status}`}>{status === "submitted" ? "Submitted" : status === "draft" ? "Draft" : "Not started"}</span>
              </span>
              <span className="cashier-shift-time">{shift.label.replace(/^Shift \d - /, "")}</span>
              {isNext && <span className="cashier-next-required">Next required</span>}
              <span className="cashier-shift-action">{!openingComplete ? "Complete opening setup first" : status === "submitted" ? "View report" : status === "draft" ? "Continue report" : "Start report"}</span>
            </button>
          );
        })}
      </div>
      <details className="cashier-dashboard-correction">
        <summary>Request Date Correction</summary>
        <p>Use this only when a saved date or shift needs admin approval before it can be corrected.</p>
        <div className="grid four">
          <Field label="Report Date"><TextInput type="date" value={correctionDraft.date} onChange={(value) => setCorrectionDraft((old) => ({ ...old, date: value }))} /></Field>
          <Field label="Shift"><SelectInput value={correctionDraft.shiftId} onChange={(value) => setCorrectionDraft((old) => ({ ...old, shiftId: value }))} options={SHIFT_OPTIONS.map((shift) => ({ value: shift.id, label: shift.label }))} /></Field>
          <Field label="Reason"><TextInput value={correctionDraft.reason} onChange={(value) => setCorrectionDraft((old) => ({ ...old, reason: value }))} /></Field>
          <button type="button" className="secondary" onClick={requestDateCorrection}>Send Request to Admin</button>
        </div>
      </details>
      {correctionReport && (
        <div className="cashier-shift-grid">
          <button type="button" className={`cashier-shift-card ${correctionApproved ? "next" : ""}`} onClick={() => onOpenCorrection(correctionReport)} disabled={!correctionApproved}>
            <span className="cashier-shift-index">CR</span>
            <span className="cashier-shift-card-top">
              <b>Requested Date Correction</b>
              <span className={`cashier-shift-status ${correctionApproved ? "submitted" : "draft"}`}>{correctionApproved ? "Approved" : "Pending"}</span>
            </span>
            <span className="cashier-shift-time">{correctionReport.date} - {shiftById(correctionReport.shiftId).label}</span>
            {correction.reason && <span className="cashier-next-required">{correction.reason}</span>}
            <span className="cashier-shift-action">{correctionApproved ? "Open approved correction" : "Waiting for admin approval"}</span>
          </button>
        </div>
      )}
    </section>
  );
}

function CashierPage({ report, result, warnings, criticalWarnings, missingPreviousShift, onGoToMissingShift, editingConflict, isSubmittingReport, activeEditors, currentShift, patchReport, updateRows, addRow, removeRow, confirmStartingOpening, confirmReport, onBackToShifts }) {
  const reviewFlags = reportReviewFlags(report, result);
  const activeRequest = correctionRequest(report);
  const fieldWarnings = pumpFieldWarnings(report);
  const openingSetupMode = Boolean(report.baselineMissing || report.baselineReport);
  const requiredFieldBlockers = [
    !hasActualCashCounted(report) ? "End-of-shift cash count is required. Complete Step 1 before submitting." : "",
    !String(report.cashierName || "").trim() ? "Cashier name is required. Complete Step 7 before submitting." : "",
    !Array.isArray(report.tankRows) || report.tankRows.some((row) => row.actualDip === "" || row.actualDip === null || row.actualDip === undefined)
      ? "Underground tank readings are incomplete. Complete Step 3 before submitting."
      : "",
    cashVoucherValidationError(report),
  ].filter(Boolean);
  const submitBlockers = [...new Set([
    ...requiredFieldBlockers,
    ...fieldWarnings.map((warning) => warning.message),
    ...criticalWarnings,
    ...warnings.filter((warning) =>
      warning.includes("pump price is missing")
      || warning.includes("No previous closing")
      || warning.includes("opening is missing")
      || warning.includes("Gross sales is unusually high")
    ),
  ])];
  const [highlightedPumpRowId, setHighlightedPumpRowId] = useState("");
  const [wizardStep, setWizardStep] = useState(() => openingSetupMode ? 1 : reportCompleted(report) ? 7 : readSavedWizardStep(report, 7));
  const [cashierNameDraft, setCashierNameDraft] = useState(report.cashierName || "");
  const [cashierNameError, setCashierNameError] = useState("");
  const [cashVoucherError, setCashVoucherError] = useState("");
  const wizardSteps = ["Physical Cash", "Pump Register", "Underground Tank", "Deductions", "PO and Cash Vouchers", "Oil and Coke", "Cashier Information", "Review and Submit"];

  useEffect(() => {
    setWizardStep((report.baselineMissing || report.baselineReport) ? 1 : reportCompleted(report) ? wizardSteps.length - 1 : readSavedWizardStep(report, wizardSteps.length - 1));
    setHighlightedPumpRowId("");
    setCashierNameDraft(report.cashierName || "");
    setCashierNameError("");
    setCashVoucherError("");
  }, [report.branch, report.date, report.shiftId, report.confirmed, report.baselineConfirmed]);

  useEffect(() => {
    if (reportCompleted(report)) {
      removeSavedWizardStep(report);
      return;
    }
    saveWizardStep(report, wizardStep);
  }, [report.branch, report.date, report.shiftId, report.confirmed, report.baselineConfirmed, wizardStep]);

  useEffect(() => {
    if (report.cashierName) setCashierNameDraft(report.cashierName);
  }, [report.cashierName]);

  function saveCashierName() {
    const name = cashierNameDraft.trim();
    if (!name) {
      setCashierNameError("Please enter the cashier's name.");
      return;
    }
    if (editingConflict) {
      setCashierNameError("This shift is open on another device. Please wait, then try again.");
      return;
    }
    setCashierNameDraft(name);
    setCashierNameError("");
    patchReport(["root", "cashierName"], name);
  }

  function fixPumpReading(rowId) {
    setWizardStep(1);
    setHighlightedPumpRowId(rowId);
    window.setTimeout(() => {
      const row = document.querySelector(`[data-pump-row-id="${rowId}"]`);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      row?.querySelector("input")?.focus();
    }, 0);
  }

  function requestWizardStep(nextStep) {
    if (openingSetupMode) {
      setWizardStep(1);
      return;
    }
    if (nextStep > 4) {
      const voucherError = cashVoucherValidationError(report);
      if (voucherError) {
        setCashVoucherError(voucherError);
        setWizardStep(4);
        return;
      }
    }
    setWizardStep(nextStep);
  }

  function attemptSubmitReport() {
    if (!hasActualCashCounted(report)) {
      setWizardStep(0);
      return;
    }
    if (fieldWarnings.length > 0) {
      fixPumpReading(fieldWarnings[0].rowId);
      return;
    }
    if (!Array.isArray(report.tankRows) || report.tankRows.some((row) => row.actualDip === "" || row.actualDip === null || row.actualDip === undefined)) {
      setWizardStep(2);
      return;
    }
    const voucherError = cashVoucherValidationError(report);
    if (voucherError) {
      setCashVoucherError(voucherError);
      setWizardStep(4);
      return;
    }
    if (!String(report.cashierName || "").trim()) {
      setCashierNameError("Please enter the cashier's name.");
      setWizardStep(6);
      return;
    }
    confirmReport();
  }

  return (
    <div className="cashier-wizard-shell">
      <div className="cashier-wizard-header">
        <div>
          <button type="button" className="cashier-back-shifts" onClick={onBackToShifts}>Back to Shifts</button>
          <span>Cashier Shift Report</span>
          <h2>{report.branch} - {currentShift.label}</h2>
          <p>{currentShift.date} - {reportStatusLabel(report, reviewFlags)}</p>
        </div>
        <div className="grid four">
          <Card title="Report Status" value={reportStatusLabel(report, reviewFlags)} tone={reportStatusTone(report, reviewFlags)} />
          {report.serverMeta?.reportId && <Card title="Confirmed Report ID" value={report.serverMeta.reportId} tone="green" />}
          <Card title="Review Status" value={<ReviewBadge flags={reviewFlags} />} note={reviewFlags.join(", ")} tone={reviewFlags.length ? "yellow" : "green"} />
        </div>
      </div>

      {!openingSetupMode && <div className="cashier-wizard-progress" aria-label={`Step ${wizardStep + 1} of ${wizardSteps.length}: ${wizardSteps[wizardStep]}`}>
        <div className="cashier-wizard-progress-copy"><b>Step {wizardStep + 1} of {wizardSteps.length}</b><span>{wizardSteps[wizardStep]}</span></div>
        <div className="cashier-wizard-track"><span style={{ width: `${((wizardStep + 1) / wizardSteps.length) * 100}%` }} /></div>
        <div className="cashier-wizard-dots">
          {wizardSteps.map((step, index) => <button key={step} type="button" className={index === wizardStep ? "active" : index < wizardStep ? "done" : ""} onClick={() => requestWizardStep(index)} aria-label={`Open ${step}`}>{index + 1}</button>)}
        </div>
      </div>}

      <div className="cashier-wizard-alerts">
        {editingConflict && (
          <WarningBanner>
            Currently being edited on another device. Please wait before saving this station and shift.
          </WarningBanner>
        )}
        <MissingPreviousShiftWarning info={missingPreviousShift} onGoToMissingShift={onGoToMissingShift} />
        {criticalWarnings.length > 0 && (
          <WarningBanner critical>
            {criticalWarnings.map((warning) => <div key={warning}>{warning}</div>)}
          </WarningBanner>
        )}
        {warnings.length > 0 && (
          <WarningBanner>
            {warnings.map((warning) => <div key={warning}>{warning}</div>)}
          </WarningBanner>
        )}
        {fieldWarnings.length > 0 && (
          <WarningBanner>
            {fieldWarnings.map((warning) => (
              <div className="pump-reading-warning" key={warning.rowId}>
                <span>{warning.message}</span>
                <button type="button" className="secondary" onClick={() => fixPumpReading(warning.rowId)}>Fix This Reading</button>
              </div>
            ))}
          </WarningBanner>
        )}
        {activeRequest.status === "approved" && (
          <WarningBanner>
            Admin approved this date correction. This exact report is open until {activeRequest.expiresAt ? new Date(activeRequest.expiresAt).toLocaleString("en-PH") : "the approval expires"} or until it is submitted again.
          </WarningBanner>
        )}
      </div>

      <fieldset className="cashier-wizard-step" disabled={reportCompleted(report)}>
      {wizardStep === 0 && (
      <Section title="End-of-Shift Cash Count">
        <p className="neutral">Count the physical cash at the end of the shift and enter the total below. Expected cash and the difference are shown only to admin.</p>
        <div className="grid two">
          <Field label="End-of-Shift Cash Count">
            <CashCountInput value={report.actualCashCounted} onChange={(value) => patchReport(["root", "actualCashCounted"], value)} />
          </Field>
        </div>
      </Section>
      )}

      {wizardStep === 1 && <>
        {report.baselineMissing && <BaselineOpeningSection report={report} patchReport={patchReport} confirmStartingOpening={confirmStartingOpening} />}
      {report.baselineReport && !report.baselineMissing && (
        <Section title="Opening Setup Complete">
          <p className="neutral">Starting readings are saved. The Official Pump Reading Register begins in the first regular shift and is not entered twice here.</p>
          <button type="button" className="primary" onClick={onBackToShifts}>Back to Shifts</button>
        </Section>
      )}
      {(report.pumpRows || []).some((row) => row.setupRequired) && !openingSetupMode && (
        <div className="warning-box">
          <b>New pump setup required.</b> Enter the exact starting physical register reading for each highlighted new pump nozzle. This is its first Previous Shift Closing and does not change older reports.
        </div>
      )}
      {!openingSetupMode && <Section title="Official Pump Reading Register">
        <Table headers={["Pump", "Nozzle", "Previous Shift Closing", "Current Closing", "Liters Sold"]} minWidth="900px">
          {report.pumpRows.map((row, index) => (
            <tr key={row.id} data-pump-row-id={row.id} className={highlightedPumpRowId === row.id ? "pump-row-highlight" : ""}>
              <td>{row.pump}</td>
              <td>{row.nozzle}</td>
              <td>
                {row.setupRequired && !reportCompleted(report)
                  ? <>
                    <NumberInput ghostZero value={row.opening} onChange={(value) => patchReport(["pumpRows", index, "opening"], value)} />
                    <small>New pump starting reading</small>
                  </>
                  : <b className="read-only-value">{row.opening}</b>}
              </td>
              <td><NumberInput ghostZero className="pump-closing-input" value={row.closingEntered ? row.closing : ""} onChange={(value) => { setHighlightedPumpRowId(""); patchReport(["pumpRows", index, "closing"], value); }} /></td>
              <td><b>{liter(pumpLitersSold(row))}</b></td>
            </tr>
          ))}
        </Table>
      </Section>}
      </>}

      {wizardStep === 2 && (
      <Section title="Underground Tank">
        <p className="neutral">Underground tank check. Official fuel sales are based on pump readings; cash variance is the main accounting check.</p>
        <Table headers={["Tank", "Previous Shift Dip", "Delivery", "Pull-Out", "Calibration", "Current Actual Dip", "Underground Tank Difference"]} minWidth="980px">
          {result.tankRows.map((row, index) => (
            <tr key={row.id}>
              <td><b>{row.tank}</b></td>
              <td><b className="read-only-value">{liter(row.opening)}</b></td>
              <td><NumberInput ghostZero value={row.delivery} onChange={(value) => patchReport(["tankRows", index, "delivery"], value)} /></td>
              <td><NumberInput ghostZero value={row.pullOut} onChange={(value) => patchReport(["tankRows", index, "pullOut"], value)} /></td>
              <td><NumberInput ghostZero value={row.calibration} onChange={(value) => patchReport(["tankRows", index, "calibration"], value)} /></td>
              <td><NumberInput ghostZero value={row.actualDip} onChange={(value) => patchReport(["tankRows", index, "actualDip"], value)} /></td>
              <td><b className={varianceClass(row.variance, true)}>{liter(row.variance)}</b></td>
            </tr>
          ))}
        </Table>
      </Section>
      )}

      {wizardStep === 3 && (
      <Section title="Deductions">
        <div className="grid four">
          <Field label="FuelTech Pay Total">
            <NumberInput
              ghostZero
              value={fuelTechPayTotal(report.deductions)}
              onChange={(next) => patchReport(["fuelTechPayTotal"], next)}
            />
          </Field>
          {visibleDeductionEntries(report.deductions).map(([key, value]) => (
            <Field key={key} label={deductionLabel(key)}><NumberInput ghostZero value={value} onChange={(next) => patchReport(["deductions", key], next)} /></Field>
          ))}
          <Field label="Points Issued"><NumberInput ghostZero value={report.pointsIssued} onChange={(value) => patchReport(["root", "pointsIssued"], value)} /></Field>
          <Field label="Points Withdrawn">
            <b className="read-only-value">{peso(pointsWithdrawnFromRedemptions(report))}</b>
            <small>Cash Redemption + Fuel Redemption</small>
          </Field>
        </div>
      </Section>
      )}

      {wizardStep === 4 && (
      <div className="grid two">
        {report.date >= PO_INTEGRATION_START_DATE ? (
          <PoTransactionList rows={report.poRows} total={result.poTotal} />
        ) : (
          <EditableList ghostZero title="PO Accounts" rows={report.poRows} firstLabel="Account" firstKey="account" total={result.poTotal} onChange={(rows) => updateRows("poRows", rows)} onAdd={() => addRow("poRows", { id: uid(), account: "", amount: 0 })} onDelete={(id) => removeRow("poRows", id)} />
        )}
        <div>
          <CashVoucherList
            rows={report.purchaseRows}
            total={result.purchaseTotal}
            onChange={(rows) => { setCashVoucherError(""); updateRows("purchaseRows", rows); }}
            onAdd={() => { setCashVoucherError(""); addRow("purchaseRows", { id: uid(), category: "", item: "", amount: 0 }); }}
            onDelete={(id) => { setCashVoucherError(""); removeRow("purchaseRows", id); }}
          />
          {cashVoucherError && <p className="error">{cashVoucherError}</p>}
        </div>
      </div>
      )}

      {wizardStep === 5 && (
      <Section title="Oil Sales and Coke Count">
        <div className="grid four">
          <Field label="Oil Sales"><NumberInput ghostZero value={report.oilSales} onChange={(value) => patchReport(["root", "oilSales"], value)} /></Field>
          <Field label="Coke Beginning"><b className="read-only-value">{report.coke.beginning}</b></Field>
          <Field label="Coke Ending"><NumberInput ghostZero value={report.coke.ending} onChange={(value) => patchReport(["coke", "ending"], value)} /></Field>
          <Card title="Coke Sold" value={`${result.cokeSold} pcs`} />
        </div>
      </Section>
      )}

      {wizardStep === 6 && (
        <Section title="Cashier Information">
          <div className="grid two">
            <Field label="Cashier Name"><TextInput value={cashierNameDraft} onChange={(value) => { setCashierNameDraft(value); setCashierNameError(""); }} onBlur={saveCashierName} maxLength={80} /></Field>
            <Card title="Station and Shift" value={report.branch} note={`${currentShift.date} - ${currentShift.label}`} tone="dark" />
          </div>
          {cashierNameError && <p className="error">{cashierNameError}</p>}
        </Section>
      )}

      {wizardStep === 7 && (
        <Section title="Review and Submit">
          <div className="grid four">
            <Card title="Cashier" value={report.cashierName || "Missing"} tone={report.cashierName ? "green" : "yellow"} />
            <Card title="Total Liters Sold" value={liter(result.totalLiters)} />
            <Card title="Pump Warnings" value={`${fieldWarnings.length}`} tone={fieldWarnings.length ? "yellow" : "green"} />
            <Card title="Report Status" value={reportStatusLabel(report, reviewFlags)} tone={reportStatusTone(report, reviewFlags)} />
          </div>
          <div className="cashier-reading-review form-space">
            <div className="cashier-reading-review-heading">
              <div>
                <b>Confirm Pump Readings</b>
                <span>Review the readings before submitting. Only suspicious rows are highlighted.</span>
              </div>
              <strong>{fieldWarnings.length ? `${fieldWarnings.length} to fix` : "All readings look normal"}</strong>
            </div>
            <Table headers={["Pump", "Nozzle", "Previous Closing", "Current Closing", "Liters Sold"]} minWidth="720px">
              {report.pumpRows.map((row) => {
                const suspicious = fieldWarnings.some((warning) => warning.rowId === row.id);
                return (
                  <tr key={`review-${row.id}`} className={suspicious ? "pump-review-row-suspicious" : ""}>
                    <td><b>{row.pump}</b></td>
                    <td>{row.nozzle}</td>
                    <td>{row.opening}</td>
                    <td>{row.closingEntered ? row.closing : "Missing"}</td>
                    <td><b>{liter(n(row.closing) - n(row.opening))}</b></td>
                  </tr>
                );
              })}
            </Table>
          </div>
          {fieldWarnings.length > 0 && <div className="warning-box form-space">{fieldWarnings.map((warning) => <div className="pump-reading-warning" key={warning.rowId}><span>{warning.message}</span><button type="button" className="secondary" onClick={() => fixPumpReading(warning.rowId)}>Fix This Reading</button></div>)}</div>}
          {submitBlockers.length > 0 && (
            <div className="warning-box form-space">
              <b>Cannot submit yet</b>
              {submitBlockers.map((warning) => <p key={warning}>{warning}</p>)}
              {submitBlockers.some((warning) => warning.includes("End-of-shift cash count")) && (
                <button type="button" className="secondary" onClick={() => setWizardStep(0)}>Go to Physical Cash</button>
              )}
              {submitBlockers.some((warning) => warning.includes("pump price is missing")) && (
                <p>Ask the manager to confirm this station's Premium, Regular, and Diesel selling prices. The cashier report will apply them automatically.</p>
              )}
            </div>
          )}
          <button type="button" className={`confirm-button ${reportStatusTone(report, reviewFlags)} form-space`} onClick={attemptSubmitReport} disabled={reportCompleted(report) || editingConflict || isSubmittingReport}>{isSubmittingReport ? "Submitting Report..." : reportCompleted(report) ? reportStatusLabel(report, reviewFlags) : "Submit Shift Report"}</button>
        </Section>
      )}
      </fieldset>

      {!openingSetupMode && <div className="cashier-wizard-actions">
        <button type="button" className="secondary" onClick={() => setWizardStep((step) => Math.max(0, step - 1))} disabled={wizardStep === 0}>Back</button>
        {wizardStep < wizardSteps.length - 1 && <button type="button" className="primary" onClick={() => requestWizardStep(Math.min(wizardSteps.length - 1, wizardStep + 1))}>Save and Next</button>}
      </div>}
    </div>
  );
}

function MidShiftPriceChangeSection({ report, addMidShiftPriceChange, patchMidShiftPriceChange, patchMidShiftPriceReading, confirmMidShiftPriceChange, removeMidShiftPriceChange }) {
  const changes = report.midShiftPriceChanges || [];

  return (
    <Section title="Price Change During Shift">
      <details className="details-panel">
        <summary>Open only if fuel price changed in the middle of this shift</summary>
        <div className="warning-box">
          Do not overwrite the whole shift price. Enter the exact price-change time, the new price, and each pump reading at the moment the price changed.
        </div>
        {changes.length === 0 ? (
          <p className="neutral">No mid-shift price changes recorded for this report.</p>
        ) : changes.map((change, changeIndex) => {
          const matchingRows = (report.pumpRows || []).filter((row) => row.product === change.product);
          return (
            <div className="price-box form-space" key={change.id}>
              <div className="grid four">
                <Field label="Product"><SelectInput value={change.product} onChange={(value) => patchMidShiftPriceChange(change.id, "product", value)} options={FUEL_TYPES} /></Field>
                <Field label="Effective Time"><TextInput type="time" value={change.effectiveTime} onChange={(value) => patchMidShiftPriceChange(change.id, "effectiveTime", value)} /></Field>
                <Field label="New Manager Price"><ManagerPriceInput ghostZero value={change.newPrice} onCommit={(value) => patchMidShiftPriceChange(change.id, "newPrice", value)} /></Field>
                <button type="button" className="small-danger" onClick={() => removeMidShiftPriceChange(change.id)}>Remove Change #{changeIndex + 1}</button>
              </div>
              <Table headers={["Pump", "Nozzle", "Opening", "Price-Change Reading", "Current Closing"]} minWidth="860px">
                {matchingRows.map((row) => (
                  <tr key={`${change.id}-${row.id}`}>
                    <td>{row.pump}</td>
                    <td>{row.nozzle}</td>
                    <td>{row.opening}</td>
                    <td><NumberInput value={midShiftReadingValue(change, row)} onChange={(value) => patchMidShiftPriceReading(change.id, midShiftPumpKey(row), value)} /></td>
                    <td>{row.closing}</td>
                  </tr>
                ))}
              </Table>
              <button type="button" className="confirm-button form-space" onClick={() => confirmMidShiftPriceChange(change.id)}>Confirm {change.product} Mid-Shift Price</button>
            </div>
          );
        })}
        <button type="button" className="secondary" onClick={addMidShiftPriceChange}>Add Mid-Shift Price Change</button>
      </details>
    </Section>
  );
}

function ManagerPage({ branch, selectedDate, setSelectedDate, prices, pricingCoverage, setPricingCoverage, pricingShiftId, setPricingShiftId, report, result, patchEffectivePrice, confirmDailyPrices, depositDate, setDepositDate, depositSalesDate, setDepositSalesDate, depositHistoryFrom, setDepositHistoryFrom, depositHistoryTo, setDepositHistoryTo, depositCoverage, setDepositCoverage, depositDraft, setDepositDraft, depositShiftIds, managerDepositRows, saveDailyBankDeposit, requestDepositRemovalFromReport, addMidShiftPriceChange, patchMidShiftPriceChange, patchMidShiftPriceReading, confirmMidShiftPriceChange, removeMidShiftPriceChange }) {
  const depositReferenceLabel = branch === "Liloan" ? "Minutes and Seconds" : "Reference";
  const groupedManagerDepositRows = groupedDepositRows(managerDepositRows);

  return (
    <div className="stack">
      <Section title="Fuel Price Setup">
        <div className="grid four">
          <Card title="Branch" value={branch} tone="dark" />
          <Field label="Price Effective Date"><TextInput type="date" value={selectedDate} onChange={setSelectedDate} /></Field>
          <Field label="Pricing Coverage"><SelectInput value={pricingCoverage} onChange={setPricingCoverage} options={PRICING_COVERAGE_OPTIONS} /></Field>
          {pricingCoverage === "Shift" ? (
            <Field label="Shift"><SelectInput value={pricingShiftId} onChange={setPricingShiftId} options={SHIFT_OPTIONS.map((shift) => ({ value: shift.id, label: shift.label }))} /></Field>
          ) : (
            <Card title="Pricing Basis" value="Daily" note="Carries forward until changed" />
          )}
          <button type="button" className="confirm-button" onClick={confirmDailyPrices}>Confirm Fuel Prices</button>
        </div>
        <div className="grid three form-space">
          {FUEL_TYPES.map((product) => (
            <div className="price-box" key={product}>
              <Field label={`${product} Manager Price`}><ManagerPriceInput value={prices[product]} onCommit={(value) => patchEffectivePrice(product, value)} /></Field>
            </div>
          ))}
        </div>
      </Section>

      <MidShiftPriceChangeSection report={report} addMidShiftPriceChange={addMidShiftPriceChange} patchMidShiftPriceChange={patchMidShiftPriceChange} patchMidShiftPriceReading={patchMidShiftPriceReading} confirmMidShiftPriceChange={confirmMidShiftPriceChange} removeMidShiftPriceChange={removeMidShiftPriceChange} />

      <Section title="Manager Summary">
        <div className="grid four">
          <Card title="Report Status" value={report.confirmed ? "Submitted" : "Draft"} tone={report.confirmed ? "green" : "yellow"} />
          <Card title="Bank Deposits" value={peso(result.bankDeposit)} />
          <Card title="Pending Verification" value={peso(result.pendingBank)} tone={n(result.pendingBank) ? "yellow" : "green"} />
          <Card title="Deposit Rows" value={`${groupedManagerDepositRows.length}`} />
        </div>
      </Section>

      <Section title="Daily Bank Deposit">
        <div className="warning-box">
          Deposits are saved by the sales date and shifts they cover. For a 1 PM deposit covering yesterday Shift 2 and Shift 3, set Deposit Date to today, Sales Date Covered to yesterday, and Covers to Shift 2 + Shift 3.
        </div>
        <div className="grid four">
          <Field label="Deposit Date"><TextInput type="date" value={depositDate} onChange={setDepositDate} /></Field>
          <Field label="Sales Date Covered"><TextInput type="date" value={depositSalesDate} onChange={setDepositSalesDate} /></Field>
          <Field label="Covers"><SelectInput value={depositCoverage} onChange={setDepositCoverage} options={DEPOSIT_COVERAGE_OPTIONS} /></Field>
          <Card title="Will Count Under" value={depositShiftIds.map((shiftId) => shiftById(shiftId).label.split(" - ")[0]).join(", ")} note={`${branch} sales date ${depositSalesDate}`} tone="dark" />
          <Field label="Bank"><TextInput value={depositDraft.bank} onChange={(value) => setDepositDraft((old) => ({ ...old, bank: value }))} /></Field>
          <Field label={depositReferenceLabel}><TextInput value={depositDraft.reference} onChange={(value) => setDepositDraft((old) => ({ ...old, reference: value }))} /></Field>
          <Field label="Amount"><NumberInput value={depositDraft.amount} onChange={(value) => setDepositDraft((old) => ({ ...old, amount: value }))} /></Field>
          <button type="button" className="confirm-button" onClick={saveDailyBankDeposit}>Save Daily Bank Deposit</button>
        </div>
        <div className="grid four form-space">
          <Field label="Deposit From"><TextInput type="date" value={depositHistoryFrom} onChange={setDepositHistoryFrom} /></Field>
          <Field label="Deposit To"><TextInput type="date" value={depositHistoryTo} onChange={setDepositHistoryTo} /></Field>
          <Card title="Deposit History" value={`${groupedManagerDepositRows.length}`} note={`${branch} only`} tone="dark" />
          <Card title="Default Range" value="Last 7 days" />
        </div>
        <Table headers={["Sales Date", "Counted Shift", "Deposit Date", "Bank", depositReferenceLabel, "Amount", "Status", "Action"]} minWidth="1080px">
          {groupedManagerDepositRows.length === 0 ? (
            <tr><td colSpan="8">No saved bank deposits for this station yet.</td></tr>
          ) : groupedManagerDepositRows.map(({ report: depositReport, deposit, items, shifts }) => (
            <tr key={`${deposit.groupId || deposit.id}-${depositReport.branch}-${depositReport.date}`}>
              <td>{deposit.salesDateCovered || depositReport.date}</td>
              <td>{deposit.coverageLabel || shifts.map((shiftId) => shiftById(shiftId).label.split(" - ")[0]).join(", ")}</td>
              <td>{deposit.depositDate || depositReport.date}</td>
              <td>{deposit.bank}</td>
              <td>{deposit.reference}</td>
              <td><b>{peso(deposit.amount)}</b></td>
              <td><Status tone={isRemovalRequested(deposit) ? "yellow" : deposit.verified ? "green" : "yellow"}>{isRemovalRequested(deposit) ? depositRequestLabel(deposit) : deposit.verified ? "Verified" : "Pending"}</Status></td>
              <td>
                <div className="action-row">
                  <button type="button" className="small-success" disabled={isRemovalRequested(deposit)} onClick={() => items.forEach((item) => requestDepositRemovalFromReport(item.deposit.id, item.report, "change"))}>
                    {isRemovalRequested(deposit) ? "Requested" : "Request Change"}
                  </button>
                  <button type="button" className="small-danger" disabled={isRemovalRequested(deposit)} onClick={() => items.forEach((item) => requestDepositRemovalFromReport(item.deposit.id, item.report, "removal"))}>
                    {isRemovalRequested(deposit) ? "Requested" : "Request Removal"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}

function MobileAdminMetric({ label, value, note, tone = "neutral" }) {
  return (
    <div className={`mobile-admin-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function MobileAdminRow({ label, value, note, tone = "neutral" }) {
  return (
    <div className={`mobile-admin-row ${tone}`}>
      <div>
        <b>{label}</b>
        {note && <span>{note}</span>}
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function MobileAdminSection({ title, children }) {
  return (
    <section className="mobile-admin-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function systemHealthSummary(systemHealth = {}) {
  const backup = systemHealth.latestBackup;
  const health = systemHealth.latestHealth;
  const payload = health?.payload || {};
  return {
    backupStatus: systemHealth.backupReady && backup ? "Working" : "Setup Needed",
    backupTone: systemHealth.backupReady && backup ? "good" : "warning",
    backupDate: backup?.backup_date || "No backup yet",
    backupReports: n(backup?.report_count),
    healthStatus: systemHealth.healthReady && health ? "Working" : "Setup Needed",
    healthTone: systemHealth.healthReady && health ? "good" : "warning",
    healthDate: health?.check_date || payload.date || "No check yet",
    missingReports: n(health?.missing_reports ?? payload.missing),
    missingDeposits: n(health?.missing_deposits ?? payload.depositMissing),
    pendingDeposits: n(health?.pending_deposits ?? payload.depositPending),
    cashVariance: n(health?.cash_variance ?? payload.cashVariance),
    error: systemHealth.error || "",
    setupNeeded: systemHealth.setupNeeded,
  };
}

function MobileCashFlowGraph({ weeklyCashFlow, monthlyCashFlow }) {
  const bars = [
    { label: "Week", value: weeklyCashFlow },
    { label: "Month", value: monthlyCashFlow },
  ];
  const maxValue = Math.max(1, ...bars.map((bar) => Math.abs(n(bar.value))));

  return (
    <div className="mobile-cash-graph" aria-label="Weekly and monthly cash flow graph">
      {bars.map((bar) => {
        const value = n(bar.value);
        const width = `${Math.max(8, Math.round((Math.abs(value) / maxValue) * 100))}%`;
        const tone = value < 0 ? "bad" : "good";
        return (
          <div className="mobile-cash-bar-row" key={bar.label}>
            <div className="mobile-cash-bar-label">
              <b>{bar.label}</b>
              <span>{cashFlowLabel(value)}</span>
            </div>
            <div className="mobile-cash-track">
              <div className={`mobile-cash-fill ${tone}`} style={{ width }} />
            </div>
            <strong>{peso(value)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function MobileStationBars({ rankingRows }) {
  const rows = rankingRows.slice(0, 6);
  const maxValue = Math.max(1, ...rows.map((row) => Math.abs(n(row.litersSold))));

  return (
    <div className="mobile-station-bars" aria-label="Station liters sold ranking graph">
      {rows.map((row) => {
        const value = n(row.litersSold);
        const width = `${Math.max(8, Math.round((Math.abs(value) / maxValue) * 100))}%`;
        return (
          <div className="mobile-station-bar" key={row.branch}>
            <div className="mobile-station-bar-top">
              <b>{row.branch}</b>
              <span>{liter(value)}</span>
            </div>
            <div className="mobile-cash-track">
              <div className="mobile-cash-fill good" style={{ width }} />
            </div>
            <strong>{liter(value)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function MobileMiniBarChart({ title, rows, formatValue = peso }) {
  const chartRows = rows.filter((row) => row);
  const maxValue = Math.max(1, ...chartRows.map((row) => Math.abs(n(row.value))));

  return (
    <div className="mobile-mini-chart" aria-label={`${title} graph`}>
      <div className="mobile-mini-chart-title">{title}</div>
      {chartRows.map((row) => {
        const value = n(row.value);
        const width = `${Math.max(8, Math.round((Math.abs(value) / maxValue) * 100))}%`;
        const tone = row.tone || (value < 0 ? "bad" : "good");
        return (
          <div className="mobile-mini-chart-row" key={row.label}>
            <div className="mobile-station-bar-top">
              <b>{row.label}</b>
              <span>{formatValue(value)}</span>
            </div>
            <div className="mobile-cash-track">
              <div className={`mobile-cash-fill ${tone}`} style={{ width }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MobileLineChart({ title, rows }) {
  const chartRows = rows.slice(-10);
  const values = chartRows.map((row) => n(row.value));
  const maxValue = Math.max(1, ...values);
  const minValue = Math.min(0, ...values);
  const range = Math.max(1, maxValue - minValue);
  const width = 320;
  const height = 150;
  const pad = 18;
  const chartWidth = width - pad * 2;
  const chartHeight = height - pad * 2;
  const points = chartRows.map((row, index) => {
    const x = pad + (chartRows.length <= 1 ? chartWidth / 2 : (index / (chartRows.length - 1)) * chartWidth);
    const y = pad + chartHeight - ((n(row.value) - minValue) / range) * chartHeight;
    return { ...row, x, y };
  });
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const areaPath = points.length
    ? `${path} L ${points[points.length - 1].x.toFixed(1)} ${height - pad} L ${points[0].x.toFixed(1)} ${height - pad} Z`
    : "";
  const best = chartRows.reduce((winner, row) => n(row.value) > n(winner?.value) ? row : winner, chartRows[0]);
  const latest = chartRows[chartRows.length - 1];

  return (
    <div className="mobile-line-chart-card" aria-label={`${title} line graph`}>
      <div className="mobile-line-chart-head">
        <div>
          <span>{title}</span>
          <strong>{latest ? peso(latest.value) : peso(0)}</strong>
        </div>
        <small>{best ? `Best ${best.label}` : "No submitted data"}</small>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} up and down graph`}>
        <defs>
          <linearGradient id="mobileLineFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="mobile-line-axis" />
        {areaPath && <path d={areaPath} className="mobile-line-area" />}
        {path && <path d={path} className="mobile-line-path" />}
        {points.map((point) => (
          <circle key={point.label} cx={point.x} cy={point.y} r="4.2" className="mobile-line-point" />
        ))}
      </svg>
      <div className="mobile-line-labels">
        <span>{chartRows[0]?.label || "Start"}</span>
        <span>{chartRows[chartRows.length - 1]?.label || "Today"}</span>
      </div>
    </div>
  );
}

function PerformanceSparkline({ rows = [] }) {
  const chartRows = rows;
  const values = chartRows.map((row) => n(row.value));
  const maxValue = Math.max(1, ...values);
  const minValue = Math.min(0, ...values);
  const range = Math.max(1, maxValue - minValue);
  const width = 180;
  const height = 30;
  const points = chartRows.map((row, index) => {
    const x = chartRows.length <= 1 ? width / 2 : (index / (chartRows.length - 1)) * width;
    const y = height - 3 - ((n(row.value) - minValue) / range) * (height - 8);
    return { ...row, x, y };
  });
  const pointList = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");

  return (
    <svg className="performance-sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Metric trend">
      <line x1="0" y1={height - 3} x2={width} y2={height - 3} />
      {pointList && <polyline points={pointList} />}
      {points.map((point) => (
        <circle key={point.key || point.label} cx={point.x} cy={point.y} r="2">
          <title>{point.label}: {new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(n(point.value))}</title>
        </circle>
      ))}
    </svg>
  );
}

function PerformanceMetric({ index, title, value, note, rows }) {
  return (
    <div className="performance-kpi">
      <div className="performance-kpi-title">
        <span>{String(index).padStart(2, "0")}</span>
        <b>{title}</b>
      </div>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
      <PerformanceSparkline rows={rows} />
    </div>
  );
}

function PerformanceVolumeChart({ rows = [], average, rangeLabel, compact = false }) {
  const chartRows = rows;
  const values = chartRows.map((row) => n(row.value));
  const maxValue = Math.max(1, ...values);
  const width = Math.max(compact ? 350 : 760, (compact ? 50 : 86) * chartRows.length);
  const height = 220;
  const left = 64;
  const right = 22;
  const top = 34;
  const bottom = 44;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const points = chartRows.map((row, index) => {
    const x = left + (chartRows.length <= 1 ? chartWidth / 2 : (index / (chartRows.length - 1)) * chartWidth);
    const y = top + chartHeight - (n(row.value) / maxValue) * chartHeight;
    return { ...row, x, y };
  });
  const linePath = points.length === 1
    ? `M ${(points[0].x - 18).toFixed(1)} ${points[0].y.toFixed(1)} L ${(points[0].x + 18).toFixed(1)} ${points[0].y.toFixed(1)}`
    : points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const areaPath = points.length > 1
    ? `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${top + chartHeight} L ${points[0].x.toFixed(1)} ${top + chartHeight} Z`
    : "";
  const gridRatios = [1, 0.75, 0.5, 0.25, 0];
  const total = values.reduce((sum, value) => sum + value, 0);
  const peak = chartRows.reduce((best, row) => n(row.value) > n(best?.value) ? row : best, chartRows[0]);

  return (
    <div className={`performance-volume-panel ${compact ? "compact" : ""}`}>
      <div className="performance-volume-head">
        <div>
          <span>Average Daily Volume</span>
          <strong>{liter(average)}</strong>
        </div>
        <div className="performance-volume-details">
          <small>{rangeLabel}</small>
          <b>{chartRows.length} period{chartRows.length === 1 ? "" : "s"} · Total {liter(total)}</b>
          <span>{peak ? `Highest: ${peak.label} · ${liter(peak.value)}` : "No submitted volume"}</span>
        </div>
      </div>
      {chartRows.length ? (
        <>
          <div className="performance-volume-chart-wrap">
          <svg className="performance-volume-chart" viewBox={`0 0 ${width} ${height}`} style={{ minWidth: `${width}px` }} role="img" aria-label="Submitted fuel volume trend">
            {gridRatios.map((ratio) => {
              const y = top + (1 - ratio) * chartHeight;
              return (
                <g key={ratio}>
                  <line x1={left} y1={y} x2={width - right} y2={y} className="performance-chart-grid" />
                  <text x={left - 10} y={y + 4} textAnchor="end" className="performance-chart-axis">
                    {new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 }).format(maxValue * ratio)}
                  </text>
                </g>
              );
            })}
            {areaPath && <path d={areaPath} className="performance-chart-area" />}
            {linePath && <path d={linePath} className="performance-chart-line" />}
            {points.map((point) => (
              <g key={point.key || point.label}>
                <circle cx={point.x} cy={point.y} r="5" className="performance-chart-point">
                  <title>{point.label}: {liter(point.value)}</title>
                </circle>
                <text x={point.x} y={Math.max(14, point.y - 11)} textAnchor="middle" className="performance-chart-value">
                  {new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 }).format(n(point.value))}
                </text>
                <text x={point.x} y={height - 19} textAnchor="middle" className="performance-chart-label">{point.label}</text>
              </g>
            ))}
          </svg>
          </div>
          <div className="performance-volume-table-wrap">
            <div
              className="performance-volume-table"
              style={{
                gridTemplateColumns: `${compact ? "66px" : "110px"} repeat(${chartRows.length}, minmax(${compact ? "40px" : "72px"}, 1fr))`,
              }}
            >
              <b>Period</b>
              {chartRows.map((row) => <span key={`label-${row.key || row.label}`}>{row.label}</span>)}
              <b>Volume</b>
              {chartRows.map((row) => <span key={`value-${row.key || row.label}`}>{liter(row.value)}</span>)}
            </div>
          </div>
        </>
      ) : (
        <div className="performance-empty">No submitted reports in this period.</div>
      )}
    </div>
  );
}

function CashVoucherBreakdown({ summary }) {
  return (
    <div className="cash-voucher-breakdown">
      <div>
        <span>Cash Voucher Breakdown</span>
        <small>Separate from the unchanged Total Deductions figure</small>
      </div>
      <div className="cash-voucher-breakdown-grid">
        {CASH_VOUCHER_CATEGORIES.map((category) => (
          <Card key={category} title={category} value={peso(summary.cashVoucherCategories?.[category])} />
        ))}
      </div>
    </div>
  );
}

function ApproverPage({ allReports, consolidatedDeposits, startDate, setStartDate, endDate, setEndDate, approveDepositVerification, reviewDepositRemovalRequest, lastRefreshedAt, logout }) {
  const [activeCategory, setActiveCategory] = useState("bank");
  const [station, setStation] = useState("All Stations");
  const [statusFilter, setStatusFilter] = useState("Pending");
  const [savingKey, setSavingKey] = useState("");
  const [message, setMessage] = useState("");

  const depositGroups = useMemo(
    () => groupedDepositRows(consolidatedDeposits)
      .filter(({ report, deposit }) => !deposit.removed && (station === "All Stations" || report.branch === station))
      .sort((a, b) => `${b.deposit.depositDate || b.report.date}|${b.report.branch}`.localeCompare(`${a.deposit.depositDate || a.report.date}|${a.report.branch}`)),
    [consolidatedDeposits, station],
  );
  const visibleGroups = useMemo(() => depositGroups.filter(({ deposit }) => {
    if (statusFilter === "Pending") return !deposit.verified && !isRemovalRequested(deposit);
    if (statusFilter === "Requests") return isRemovalRequested(deposit);
    if (statusFilter === "Verified") return deposit.verified && !isRemovalRequested(deposit);
    return true;
  }), [depositGroups, statusFilter]);
  const depositHealth = useMemo(
    () => depositHealthRows(allReports, startDate, endDate)
      .filter((row) => station === "All Stations" || row.branch === station),
    [allReports, startDate, endDate, station],
  );
  const depositHealthCounts = useMemo(() => statusCounts(depositHealth), [depositHealth]);
  const missingDeposits = useMemo(() => depositHealth.flatMap((row) =>
    row.shifts
      .filter(({ status }) => status.label === "Deposit Missing")
      .map(({ shift }) => ({ date: row.date, branch: row.branch, shift }))
  ), [depositHealth]);
  const totalAmount = depositGroups.reduce((sum, group) => sum + n(group.deposit.amount), 0);
  const verifiedAmount = depositGroups.filter((group) => group.deposit.verified).reduce((sum, group) => sum + n(group.deposit.amount), 0);
  const pendingAmount = totalAmount - verifiedAmount;
  const removalRequestGroups = depositGroups.filter((group) => isRemovalRequested(group.deposit));

  async function approveGroup(group) {
    const { report, deposit, items } = group;
    if (deposit.verified || isRemovalRequested(deposit)) return;
    const label = `${report.branch} deposit of ${peso(deposit.amount)}`;
    if (!window.confirm(`Approve ${label}? This confirms that the bank deposit was verified.`)) return;

    const key = deposit.groupId || `${report.branch}-${report.date}-${report.shiftId}-${deposit.id}`;
    setSavingKey(key);
    setMessage("");
    try {
      for (const item of items.filter(({ deposit: rowDeposit }) => !rowDeposit.verified)) {
        await approveDepositVerification(item.deposit.id, item.report);
      }
      setMessage(`${label} was approved.`);
    } catch (error) {
      setMessage(error.message || "Unable to approve this bank deposit.");
    } finally {
      setSavingKey("");
    }
  }

  async function reviewRemovalGroup(group, decision) {
    const { report, deposit, items } = group;
    if (!isRemovalRequested(deposit)) return;
    const actionLabel = decision === "approve" ? depositRequestActionLabel(deposit) : "Reject Request";
    if (!window.confirm(`${actionLabel} for the ${report.branch} deposit of ${peso(deposit.amount)}?`)) return;

    const key = deposit.groupId || `${report.branch}-${report.date}-${report.shiftId}-${deposit.id}`;
    setSavingKey(key);
    setMessage("");
    try {
      for (const item of items.filter(({ deposit: rowDeposit }) => isRemovalRequested(rowDeposit))) {
        await reviewDepositRemovalRequest(item.deposit.id, item.report, decision);
      }
      setMessage(decision === "approve"
        ? `${report.branch} deposit removal was approved.`
        : `${report.branch} deposit removal request was rejected.`);
    } catch (error) {
      setMessage(error.message || "Unable to review this deposit request.");
    } finally {
      setSavingKey("");
    }
  }

  return (
    <div className="approver-shell">
      <header className="approver-header">
        <div>
          <span className="approver-eyebrow">FUELTECH ACCOUNTING</span>
          <h1>{activeCategory === "bank" ? "Bank Verification" : "Deposit Health"}</h1>
          <p>{activeCategory === "bank" ? "Approve bank deposits from all stations." : "See which stations have not recorded their deposits."}</p>
        </div>
        <div className="approver-header-actions">
          <small>{formatRefreshTime(lastRefreshedAt)}</small>
          <button type="button" className="approver-logout" onClick={logout}>Log Out</button>
        </div>
      </header>

      <nav className="approver-category-nav" aria-label="Approver categories">
        <button type="button" className={activeCategory === "bank" ? "active" : ""} onClick={() => setActiveCategory("bank")}>Bank Verification</button>
        <button type="button" className={activeCategory === "health" ? "active" : ""} onClick={() => setActiveCategory("health")}>Deposit Health</button>
      </nav>

      <section className="approver-filters" aria-label="Bank verification filters">
        <Field label="Station"><SelectInput value={station} onChange={setStation} options={["All Stations", ...BRANCHES]} /></Field>
        <Field label="From"><TextInput type="date" value={startDate} onChange={setStartDate} /></Field>
        <Field label="To"><TextInput type="date" value={endDate} onChange={setEndDate} /></Field>
      </section>

      {activeCategory === "bank" && (
      <>
      <section className="approver-totals" aria-label="Total bank verification">
        <div className="approver-total-card">
          <span>Total Bank Deposits</span>
          <strong>{peso(totalAmount)}</strong>
          <small>{depositGroups.length} deposit{depositGroups.length === 1 ? "" : "s"}</small>
        </div>
        <div className="approver-total-card verified">
          <span>Verified Total</span>
          <strong>{peso(verifiedAmount)}</strong>
          <small>{depositGroups.filter((group) => group.deposit.verified).length} approved</small>
        </div>
        <div className="approver-total-card pending">
          <span>Pending Verification</span>
          <strong>{peso(pendingAmount)}</strong>
          <small>{depositGroups.filter((group) => !group.deposit.verified).length} waiting</small>
        </div>
        <div className="approver-total-card requests">
          <span>Removal Requests</span>
          <strong>{removalRequestGroups.length}</strong>
          <small>{peso(removalRequestGroups.reduce((sum, group) => sum + n(group.deposit.amount), 0))} requested</small>
        </div>
      </section>

      <div className="approver-list-head">
        <div>
          <h2>Bank Deposits</h2>
          <p>{visibleGroups.length} shown</p>
        </div>
        <div className="approver-status-filter" aria-label="Deposit status">
          {["Pending", "Requests", "Verified", "All"].map((status) => (
            <button type="button" key={status} className={statusFilter === status ? "active" : ""} onClick={() => setStatusFilter(status)}>{status}</button>
          ))}
        </div>
      </div>

      {message && <p className="approver-message" role="status">{message}</p>}

      <section className="approver-deposit-grid">
        {visibleGroups.length === 0 ? (
          <div className="approver-empty">No {statusFilter.toLowerCase()} bank deposits in this date range.</div>
        ) : visibleGroups.map((group) => {
          const { report, deposit } = group;
          const key = deposit.groupId || `${report.branch}-${report.date}-${report.shiftId}-${deposit.id}`;
          const onHold = isRemovalRequested(deposit);
          const coveredShifts = (deposit.coveredShiftIds?.length ? deposit.coveredShiftIds : group.shifts)
            .filter(Boolean)
            .map(shortShiftLabel)
            .join(", ");
          return (
            <article className="approver-deposit-card" key={key}>
              <div className="approver-deposit-title">
                <div>
                  <span>{report.branch}</span>
                  <strong>{peso(deposit.amount)}</strong>
                </div>
                <Status tone={onHold ? "yellow" : deposit.verified ? "green" : "yellow"}>
                  {onHold ? "On Hold" : deposit.verified ? "Verified" : "Pending"}
                </Status>
              </div>
              <dl className="approver-deposit-details">
                <div><dt>Deposit Date</dt><dd>{deposit.depositDate || report.date}</dd></div>
                <div><dt>Sales Date</dt><dd>{deposit.salesDateCovered || report.date}</dd></div>
                <div><dt>Covered Shifts</dt><dd>{coveredShifts || shortShiftLabel(report.shiftId)}</dd></div>
                <div><dt>Bank</dt><dd>{deposit.bank || "Not entered"}</dd></div>
                <div><dt>Reference</dt><dd>{deposit.reference || "Not entered"}</dd></div>
              </dl>
              {onHold ? (
                <div className="approver-request-actions">
                  <p className="approver-hold-note">{depositRequestLabel(deposit)}</p>
                  <button type="button" className="approver-remove" disabled={savingKey === key} onClick={() => reviewRemovalGroup(group, "approve")}>
                    {savingKey === key ? "Saving..." : depositRequestActionLabel(deposit)}
                  </button>
                  <button type="button" className="approver-reject" disabled={savingKey === key} onClick={() => reviewRemovalGroup(group, "reject")}>Reject Request</button>
                </div>
              ) : deposit.verified ? (
                <p className="approver-verified-note">Approved {deposit.verifiedAt ? new Date(deposit.verifiedAt).toLocaleString() : ""}</p>
              ) : (
                <button type="button" className="approver-approve" disabled={savingKey === key} onClick={() => approveGroup(group)}>
                  {savingKey === key ? "Approving..." : "Approve Bank Deposit"}
                </button>
              )}
            </article>
          );
        })}
      </section>
      </>
      )}

      {activeCategory === "health" && (
        <section className="approver-health approver-health-admin" aria-label="Deposit health summary">
          <div className="approver-health-head">
            <div>
              <h2>Deposit Health Summary</h2>
              <p>Confirmed shifts that still have no bank deposit.</p>
            </div>
            <strong className={missingDeposits.length ? "has-missing" : ""}>{missingDeposits.length} missing</strong>
          </div>
          <div className="grid four approver-health-admin-counts">
            <Card title="Deposit Saved" value={`${n(depositHealthCounts["Deposit Saved"])}`} tone="green" />
            <Card title="Deposit Pending" value={`${n(depositHealthCounts["Deposit Pending"])}`} tone={n(depositHealthCounts["Deposit Pending"]) ? "yellow" : "green"} />
            <Card title="Deposit Missing" value={`${missingDeposits.length}`} tone={missingDeposits.length ? "red" : "green"} />
            <Card title="No Report" value={`${n(depositHealthCounts["No Report"])}`} tone={n(depositHealthCounts["No Report"]) ? "red" : "green"} />
          </div>
          <Table headers={["Date", "Station", ...SHIFT_OPTIONS.map((shift) => shift.label)]} minWidth="1040px">
            {depositHealth.map((row) => (
              <tr key={`approver-deposit-${row.date}-${row.branch}`}>
                <td>{row.date}</td>
                <td><b>{row.branch}</b></td>
                {row.shifts.map(({ shift, status }) => (
                  <td key={shift.id}><Status tone={status.tone}>{status.label}</Status></td>
                ))}
              </tr>
            ))}
          </Table>
        </section>
      )}
    </div>
  );
}

function MobileDepositApprovalList({ consolidatedDeposits, verifyDeposit, approveDepositRemoval, rejectDepositRemoval }) {
  const visibleRows = consolidatedDeposits.slice(0, 12);

  return (
    <div className="mobile-deposit-list">
      {visibleRows.length === 0 ? (
        <div className="mobile-deposit-card empty">No bank deposits in the selected summary date range.</div>
      ) : visibleRows.map(({ report: depositReport, deposit }) => (
        <div className="mobile-deposit-card" key={`${depositReport.branch}-${depositReport.date}-${depositReport.shiftId}-${deposit.id}`}>
          <div className="mobile-deposit-topline">
            <div>
              <b>{depositReport.branch}</b>
              <span>{deposit.salesDateCovered || depositReport.date} - {shortShiftLabel(depositReport.shiftId)}</span>
            </div>
            <Status tone={isRemovalRequested(deposit) ? "yellow" : deposit.verified ? "green" : "yellow"}>
              {isRemovalRequested(deposit) ? depositRequestLabel(deposit) : deposit.verified ? "Verified" : "Pending"}
            </Status>
          </div>
          <div className="mobile-deposit-details">
            <MobileAdminRow label="Deposit Date" value={deposit.depositDate || depositReport.date} />
            <MobileAdminRow label="Bank" value={deposit.bank || "No bank"} />
            <MobileAdminRow label="Reference" value={deposit.reference || "No reference"} />
            <MobileAdminRow label="Amount" value={peso(deposit.amount)} tone={deposit.verified ? "good" : "warning"} />
          </div>
          <div className="mobile-admin-action-row mobile-deposit-actions">
            {isRemovalRequested(deposit) ? (
              <>
                <button type="button" className="small-danger" onClick={() => approveDepositRemoval(deposit.id, depositReport)}>{depositRequestActionLabel(deposit)}</button>
                <button type="button" className="small-success" onClick={() => rejectDepositRemoval(deposit.id, depositReport)}>Reject Removal</button>
              </>
            ) : (
              <button type="button" className="small-success" onClick={() => verifyDeposit(deposit.id, depositReport)}>
                {deposit.verified ? "Undo Verification" : "Verify Deposit"}
              </button>
            )}
          </div>
        </div>
      ))}
      {consolidatedDeposits.length > visibleRows.length && (
        <div className="mobile-deposit-card empty">{consolidatedDeposits.length - visibleRows.length} more deposits are available on desktop.</div>
      )}
    </div>
  );
}

function MobileStationHealthMatrix({ healthRows }) {
  const visibleRows = healthRows.slice(0, 6);

  return (
    <div className="mobile-health-matrix">
      {visibleRows.length === 0 ? (
        <div className="mobile-health-empty">No station health rows in this date range.</div>
      ) : visibleRows.map((row) => (
        <div className="mobile-health-row" key={`${row.date}-${row.branch}`}>
          <div className="mobile-health-station">
            <b>{row.branch}</b>
            <span>{row.date}</span>
          </div>
          <div className="mobile-health-shifts">
            {row.shifts.map(({ shift, status }) => (
              <div className={`mobile-health-shift ${status.tone}`} key={shift.id}>
                <span>{shortShiftLabel(shift.id)}</span>
                <strong>{status.label}</strong>
              </div>
            ))}
          </div>
        </div>
      ))}
      {healthRows.length > visibleRows.length && (
        <div className="mobile-health-empty">{healthRows.length - visibleRows.length} more station rows are available in desktop view.</div>
      )}
    </div>
  );
}

function AdminControlStrip({ branch, setBranch, selectedDate, setSelectedDate, selectedShiftId, setSelectedShiftId, lastRefreshedAt, logout }) {
  return (
    <div className="admin-control-strip">
      <div className="admin-control-title">
        <span>FuelTech Accounting</span>
        <strong>Admin Dashboard</strong>
        <button type="button" className="admin-logout-button" onClick={logout}>Log Out</button>
      </div>
      <Field label="Branch"><SelectInput value={branch} onChange={setBranch} options={BRANCHES} /></Field>
      <Field label="Report Date"><TextInput type="date" value={selectedDate} onChange={setSelectedDate} /></Field>
      <Field label="Report Shift"><SelectInput value={selectedShiftId} onChange={setSelectedShiftId} options={SHIFT_OPTIONS.map((shift) => ({ value: shift.id, label: shift.label }))} /></Field>
      <Card title="Live Updates" value="On database change" note={formatRefreshTime(lastRefreshedAt)} />
    </div>
  );
}

function ownerBranchLabel(branch) {
  return branch;
}

function ownerPricesForBranch(priceBook, branch, selectedDate, selectedShiftId) {
  const dailyPricing = getEffectiveDailyPricing(priceBook || {}, branch, selectedDate);
  const shiftPricing = getEffectivePricing(priceBook || {}, branch, selectedDate, selectedShiftId);
  const latestCosts = latestFuelCostsForBranch(priceBook || {}, branch, selectedDate);
  return { ...dailyPricing.prices, ...shiftPricing.prices, ...latestCosts };
}

function ownerHasPrices(prices) {
  return FUEL_TYPES.some((product) => n(prices?.[product]) > 0);
}

function latestConfirmedReportsByBranch(reports = []) {
  const reportList = Array.isArray(reports) ? reports : Object.values(reports || {});
  return reportList.reduce((latest, report) => {
    if (!report?.confirmed) return latest;
    const current = latest[report.branch];
    const currentKey = current ? `${current.date || ""}-${current.shiftId || ""}` : "";
    const nextKey = `${report.date || ""}-${report.shiftId || ""}`;
    if (!current || nextKey >= currentKey) latest[report.branch] = report;
    return latest;
  }, {});
}

function ownerReportsSinceAccountingStart(reports = []) {
  const reportList = Array.isArray(reports) ? reports : Object.values(reports || {});
  return reportList.filter((report) =>
    report?.confirmed
    && String(report.date || "") >= OWNER_ACCOUNTING_START_DATE
    && String(report.date || "") <= TODAY
  );
}

function ownerSummaryByBranch(reports = []) {
  return Object.fromEntries(OWNER_DISPLAY_BRANCHES.map((branch) => {
    const branchReports = reports.filter((report) => report.branch === branch);
    return [branch, summarizeReports(branchReports)];
  }));
}

function ownerReportRangeLabel() {
  return `${OWNER_ACCOUNTING_START_DATE} to ${TODAY}`;
}

function ownerTankValue(report, prices) {
  if (!report?.confirmed) return 0;
  return (report.tankRows || []).reduce((sum, row) => {
    return sum + n(row.actualDip) * n(prices[row.product]);
  }, 0);
}

function ownerCashOnHand(report) {
  if (!report?.confirmed) return 0;
  const result = compute(report);
  return n(result.pendingCashOnHand);
}

function ownerAverage(rows, product) {
  const values = rows.map((row) => row[product]).filter((value) => value !== null && value !== undefined);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + n(value), 0) / values.length;
}

function ownerPeso(value, suffix = "") {
  if (value === null || value === undefined) return "Not set";
  return `${peso(value)}${suffix}`;
}

function compactPeso(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n(value));
}

function ownerTotalCashForReport(report) {
  const result = compute(report);
  return n(result.bankDeposit) + n(result.pendingCashOnHand);
}

function OwnerTotalCashChart({ rows, total }) {
  const chartRows = rows;
  const left = 50;
  const right = 12;
  const width = Math.max(360, left + right + chartRows.length * 56);
  const height = 170;
  const top = 25;
  const bottom = 34;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maxValue = Math.max(1, ...chartRows.map((row) => n(row.value)));
  const slotWidth = chartRows.length ? chartWidth / chartRows.length : chartWidth;
  const barWidth = Math.max(10, Math.min(28, slotWidth * 0.58));
  const gridValues = [1, 0.5, 0];
  const peak = chartRows.reduce((best, row) => n(row.value) > n(best?.value) ? row : best, chartRows[0]);

  return (
    <div className="owner-total-cash-chart">
      <div className="owner-total-cash-chart-head">
        <div>
          <span>Selected Total</span>
          <strong>{peso(total)}</strong>
        </div>
        <small>
          {chartRows.length ? `${chartRows.length} period point${chartRows.length === 1 ? "" : "s"}` : "No submitted data"}
          {peak ? ` · Highest ${peak.label}: ${compactPeso(peak.value)}` : ""}
        </small>
      </div>
      <div className="owner-total-cash-chart-scroll">
      <svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: `${width}px` }} role="img" aria-label="Total Cash graph for the selected period">
        {gridValues.map((ratio) => {
          const y = top + (1 - ratio) * chartHeight;
          return (
            <g key={ratio}>
              <line x1={left} y1={y} x2={width - right} y2={y} className="owner-chart-grid" />
              <text x={left - 7} y={y + 4} textAnchor="end" className="owner-chart-axis-label">{compactPeso(maxValue * ratio)}</text>
            </g>
          );
        })}
        {chartRows.map((row, index) => {
          const value = n(row.value);
          const barHeight = maxValue > 0 ? (value / maxValue) * chartHeight : 0;
          const x = left + index * slotWidth + (slotWidth - barWidth) / 2;
          const y = top + chartHeight - barHeight;
          return (
            <g key={row.key || row.label}>
              <rect x={x} y={y} width={barWidth} height={Math.max(1, barHeight)} rx="3" className="owner-chart-bar">
                <title>{row.label}: {peso(value)}</title>
              </rect>
              <text x={x + barWidth / 2} y={Math.max(11, y - 6)} textAnchor="middle" className="owner-chart-value">{compactPeso(value)}</text>
              <text x={x + barWidth / 2} y={height - 17} textAnchor="middle" className="owner-chart-label">{row.label}</text>
            </g>
          );
        })}
      </svg>
      </div>
    </div>
  );
}

function OwnerMobileSummary({ selectedDate, selectedShiftId, lastRefreshedAt, priceBook, allReports }) {
  const [ownerPeriod, setOwnerPeriod] = useState("Daily");
  const [ownerAnchorDate, setOwnerAnchorDate] = useState(() => localDateKey());
  const [ownerShiftId, setOwnerShiftId] = useState(selectedShiftId || "shift-1");
  const [followToday, setFollowToday] = useState(true);

  useEffect(() => {
    if (!followToday) return undefined;
    const syncDate = () => setOwnerAnchorDate(localDateKey());
    syncDate();
    const interval = window.setInterval(syncDate, 60_000);
    return () => window.clearInterval(interval);
  }, [followToday]);

  const periodRange = ownerPeriodRange(ownerPeriod, ownerAnchorDate, OWNER_ACCOUNTING_START_DATE);
  const ownerReports = ownerReportsForPeriod(allReports, periodRange, ownerPeriod, ownerShiftId);
  const confirmedReportsToDate = Object.values(allReports || {}).filter((report) =>
    report?.confirmed
    && String(report.date || "") >= OWNER_ACCOUNTING_START_DATE
    && String(report.date || "") <= periodRange.end
  );
  const latestReports = latestConfirmedReportsByBranch(confirmedReportsToDate);
  const ownerSummaries = ownerSummaryByBranch(ownerReports);
  const ownerRange = periodRange.start === periodRange.end ? periodRange.start : `${periodRange.start} to ${periodRange.end}`;
  const trendRows = ownerCashTrendRows(
    ownerReports,
    ownerPeriod,
    periodRange,
    ownerTotalCashForReport,
    OWNER_DISPLAY_BRANCHES,
    SHIFT_OPTIONS.map((shift) => ({ id: shift.id, shortLabel: shortShiftLabel(shift.id) }))
  );
  const priceRows = OWNER_DISPLAY_BRANCHES.map((branch) => ({
    branch,
    label: ownerBranchLabel(branch),
    prices: ownerPricesForBranch(priceBook, branch, periodRange.end, ownerShiftId),
  }));
  const marginRows = priceRows.map((row) => {
    const hasPrices = ownerHasPrices(row.prices);
    const productMargin = (product) => {
      const price = n(row.prices[product]);
      const cost = fuelCostForProduct(row.prices, product);
      return hasPrices && price > 0 && cost > 0 ? price - cost : null;
    };
    return {
      branch: row.branch,
      label: row.label,
      Premium: productMargin("Premium"),
      Regular: productMargin("Regular"),
      Diesel: productMargin("Diesel"),
    };
  });
  const tankRows = priceRows.map((row) => ({
    branch: row.branch,
    label: row.label,
    value: ownerTankValue(latestReports[row.branch], row.prices),
  }));
  const totalCashRows = OWNER_DISPLAY_BRANCHES.map((branch) => ({
    branch,
    label: ownerBranchLabel(branch),
    value: n(ownerSummaries[branch]?.bankDeposit) + n(ownerSummaries[branch]?.pendingCashOnHand),
  }));
  const poRows = OWNER_DISPLAY_BRANCHES.map((branch) => {
    return {
      branch,
      label: ownerBranchLabel(branch),
      value: ownerSummaries[branch]?.poTotal || 0,
    };
  });
  const totalTank = tankRows.reduce((sum, row) => sum + n(row.value), 0);
  const grandTotalCash = totalCashRows.reduce((sum, row) => sum + n(row.value), 0);
  const totalPoBilling = poRows.reduce((sum, row) => sum + n(row.value), 0);
  const averageMarginByProduct = Object.fromEntries(FUEL_TYPES.map((product) => [product, ownerAverage(marginRows, product)]));
  const averageMargins = FUEL_TYPES.map((product) => ownerAverage(marginRows, product)).filter((value) => value !== null);
  const averageMargin = averageMargins.length ? averageMargins.reduce((sum, value) => sum + n(value), 0) / averageMargins.length : null;
  const livePriceCount = priceRows.filter((row) => ownerHasPrices(row.prices)).length;

  return (
    <div className="owner-mobile-panel">
      <header className="owner-mobile-header">
        <div>
          <span>Live Owner View</span>
          <h2>Owner Summary</h2>
          <p>{ownerPeriod} · {ownerRange}</p>
        </div>
        <small>{formatRefreshTime(lastRefreshedAt)}</small>
      </header>

      <section className="owner-period-panel" aria-label="Owner summary period">
        <div className="owner-period-grid">
          <Field label="View">
            <SelectInput value={ownerPeriod} onChange={setOwnerPeriod} options={OWNER_PERIOD_OPTIONS} />
          </Field>
          <Field label="Date">
            <TextInput
              type="date"
              min={OWNER_ACCOUNTING_START_DATE}
              max={localDateKey()}
              value={ownerAnchorDate}
              onChange={(value) => {
                setOwnerAnchorDate(value);
                setFollowToday(value === localDateKey());
              }}
            />
          </Field>
          {ownerPeriod === "Shift" && (
            <Field label="Shift">
              <SelectInput value={ownerShiftId} onChange={setOwnerShiftId} options={SHIFT_OPTIONS.map((shift) => ({ value: shift.id, label: shift.label }))} />
            </Field>
          )}
          <button
            type="button"
            className={`owner-today-button ${followToday ? "active" : ""}`}
            onClick={() => {
              setOwnerAnchorDate(localDateKey());
              setFollowToday(true);
            }}
          >
            {followToday ? "Following Today" : "Go to Today"}
          </button>
        </div>
        <p>Showing submitted reports from {ownerRange}{ownerPeriod === "Shift" ? ` · ${shortShiftLabel(ownerShiftId)}` : ""}.</p>
      </section>

      <div className="owner-margin-box">
        <h3>Margins</h3>
        <div className="owner-margin-card owner-margin-average">
          <span>Average</span>
          <strong>{ownerPeso(averageMargin, "/L")}</strong>
        </div>
        <div className="owner-margin-grid">
          <div className="owner-margin-card owner-margin-product">
            <span>Premium</span>
            <strong>{ownerPeso(averageMarginByProduct.Premium, "/L")}</strong>
          </div>
          <div className="owner-margin-card owner-margin-product">
            <span>Regular</span>
            <strong>{ownerPeso(averageMarginByProduct.Regular, "/L")}</strong>
          </div>
          <div className="owner-margin-card owner-margin-product">
            <span>Diesel</span>
            <strong>{ownerPeso(averageMarginByProduct.Diesel, "/L")}</strong>
          </div>
        </div>
      </div>

      <div className="owner-kpi-grid">
        <div className="owner-kpi-card owner-kpi-cash owner-kpi-total-cash">
          <span>Total Cash</span>
          <strong>{peso(grandTotalCash)}</strong>
          <small>{ownerPeriod} total across all stations</small>
        </div>
        <div className="owner-kpi-card owner-kpi-po">
          <span>Total PO Billing</span>
          <strong>{peso(totalPoBilling)}</strong>
        </div>
        <div className="owner-kpi-card">
          <span>Tank Total Value</span>
          <strong>{peso(totalTank)}</strong>
        </div>
      </div>

      <section className="owner-section">
        <div className="owner-section-head">
          <h3>Total Cash Graph</h3>
          <p>{ownerPeriod} view for {ownerRange}.</p>
        </div>
        <OwnerTotalCashChart rows={trendRows} total={grandTotalCash} />
      </section>

      <section className="owner-section">
        <div className="owner-section-head">
          <h3>Net Fuel Margin</h3>
          <p>Live prices set: {livePriceCount}/{OWNER_DISPLAY_BRANCHES.length} stations.</p>
          <p>Selling price minus saved fuel delivery cost.</p>
        </div>
        <OwnerFuelTable rows={marginRows} average label="Station" />
      </section>

      <section className="owner-section">
        <div className="owner-section-head">
          <h3>Tank Total Value</h3>
          <p>Latest submitted tank dips multiplied by station prices.</p>
        </div>
        <OwnerValueList rows={tankRows} total={totalTank} />
      </section>

      <section className="owner-section">
        <div className="owner-section-head">
          <h3>Total Cash</h3>
          <p>Combined total recorded for {ownerRange}.</p>
        </div>
        <OwnerValueList rows={totalCashRows} total={grandTotalCash} />
      </section>

      <section className="owner-section">
        <div className="owner-section-head">
          <h3>PO Billing</h3>
          <p>Total PO entered from {ownerRange}.</p>
        </div>
        <OwnerValueList rows={poRows} total={totalPoBilling} />
      </section>

      <section className="owner-section">
        <div className="owner-section-head">
          <h3>All Station Prices</h3>
          <p>Premium, regular, and diesel prices for every station.</p>
        </div>
        <div className="owner-price-list">
          {priceRows.map((row) => (
            <article className="owner-price-card" key={row.branch}>
              <b>{row.label}</b>
              <div><span>P</span><strong>{n(row.prices.Premium) > 0 ? peso(row.prices.Premium) : "Not set"}</strong></div>
              <div><span>R</span><strong>{n(row.prices.Regular) > 0 ? peso(row.prices.Regular) : "Not set"}</strong></div>
              <div><span>D</span><strong>{n(row.prices.Diesel) > 0 ? peso(row.prices.Diesel) : "Not set"}</strong></div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function AdminMobilePerformance({ logout, sessionToken, lastRefreshedAt, priceBook, allReports, correctionRequests, approveCorrectionRequest, rejectCorrectionRequest }) {
  const [activeView, setActiveView] = useState(() => (
    new URLSearchParams(window.location.search).get("view") === "corrections" ? "corrections" : "performance"
  ));
  const [notificationStatus, setNotificationStatus] = useState(() => (
    typeof Notification === "undefined" ? "Notifications are not supported on this phone." : ""
  ));
  const [enablingNotifications, setEnablingNotifications] = useState(false);
  const [station, setStation] = useState("All Stations");
  const [period, setPeriod] = useState("Daily");
  const [shiftId, setShiftId] = useState("shift-1");
  const [anchorDate, setAnchorDate] = useState(() => localDateKey());
  const range = ownerPeriodRange(period, anchorDate, OWNER_ACCOUNTING_START_DATE);
  const branches = station === "All Stations" ? BRANCHES : [station];
  const shifts = SHIFT_OPTIONS.map((shift) => ({ id: shift.id, shortLabel: shortShiftLabel(shift.id) }));
  const reports = useMemo(() => Object.values(allReports || {}).filter((item) => (
    item?.confirmed
    && item.date >= range.start
    && item.date <= range.end
    && (station === "All Stations" || item.branch === station)
    && (period !== "Shift" || item.shiftId === shiftId)
  )), [allReports, station, period, anchorDate, shiftId]);
  const summary = useMemo(() => summarizeReports(reports), [reports]);
  const trend = (valueForReport) => ownerCashTrendRows(reports, period, range, valueForReport, branches, shifts);
  const trends = useMemo(() => ({
    volume: trend((item) => compute(item).totalLiters),
    fuelTechPay: trend((item) => fuelTechPayTotal(item.deductions)),
    po: trend((item) => compute(item).poTotal),
    fuelRedemption: trend((item) => n(item.deductions?.fuelRedemption)),
    cashRedemption: trend((item) => n(item.deductions?.cashRedemption)),
    coke: trend((item) => compute(item).cokeSold),
    points: trend((item) => compute(item).pointsIssued),
    cashVouchers: trend((item) => compute(item).purchaseTotal),
  }), [reports, period, range.start, range.end, station]);
  const dayCount = new Set(reports.map((item) => item.date)).size;
  const averageDailyVolume = dayCount ? summary.totalLiters / dayCount : 0;
  const tankInventoryValue = useMemo(() => {
    const eligibleReports = Object.values(allReports || {}).filter((item) =>
      item?.confirmed
      && item.date <= range.end
      && (station === "All Stations" || item.branch === station)
    );
    const latestReports = latestConfirmedReportsByBranch(eligibleReports);
    return Object.values(latestReports).reduce((total, item) => {
      const prices = ownerPricesForBranch(priceBook, item.branch, item.date, item.shiftId);
      return total + ownerTankValue(item, prices);
    }, 0);
  }, [allReports, station, range.end, priceBook]);
  const marginRows = useMemo(() => branches.map((branch) => {
    const prices = ownerPricesForBranch(priceBook, branch, range.end, "shift-3");
    const customerDiscount = branch === "Liloan" ? 3 : 2;
    return {
      branch,
      ...Object.fromEntries(FUEL_TYPES.map((product) => {
        const sellingPrice = n(prices[product]);
        const deliveryCost = fuelCostForProduct(prices, product);
        return [product, sellingPrice > 0 && deliveryCost > 0 ? sellingPrice - deliveryCost - customerDiscount : null];
      })),
    };
  }), [branches.join("|"), priceBook, range.end]);
  const fuelRedemption = reports.reduce((sum, item) => sum + n(item.deductions?.fuelRedemption), 0);
  const cashRedemption = reports.reduce((sum, item) => sum + n(item.deductions?.cashRedemption), 0);
  const rangeLabel = range.start === range.end ? range.start : `${range.start} to ${range.end}`;

  useEffect(() => {
    if (!("serviceWorker" in navigator) || typeof Notification === "undefined") return;
    if (Notification.permission === "denied") {
      setNotificationStatus("Notifications are blocked in this phone's browser settings.");
      return;
    }
    navigator.serviceWorker.getRegistration("/").then(async (registration) => {
      const subscription = await registration?.pushManager?.getSubscription();
      setNotificationStatus(subscription ? "Correction alerts are enabled on this phone." : "Enable alerts once to receive new correction requests.");
    }).catch(() => setNotificationStatus("Enable alerts once to receive new correction requests."));
  }, []);

  function selectView(view) {
    setActiveView(view);
    const url = new URL(window.location.href);
    if (view === "corrections") url.searchParams.set("view", "corrections");
    else url.searchParams.delete("view");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function enableCorrectionNotifications() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
      setNotificationStatus("This phone or browser does not support push notifications.");
      return;
    }

    setEnablingNotifications(true);
    setNotificationStatus("Enabling correction alerts...");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setNotificationStatus("Notification permission was not allowed. Enable it in the phone's browser settings.");
        return;
      }
      const registration = await navigator.serviceWorker.register("/fueltech-sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const config = await apiPost("/api/notifications/subscribe", { action: "config" }, sessionToken);
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.publicKey),
        });
      }
      await apiPost("/api/notifications/subscribe", { action: "subscribe", subscription: subscription.toJSON() }, sessionToken);
      setNotificationStatus("Correction alerts are enabled on this phone.");
      await registration.showNotification("FuelTech alerts enabled", {
        body: "This phone will notify you when a new date correction is requested.",
        icon: "/fueltech-icon-192-v3.png",
        tag: "fueltech-alerts-enabled",
      });
    } catch (error) {
      setNotificationStatus(error.message || "Unable to enable notifications on this phone.");
    } finally {
      setEnablingNotifications(false);
    }
  }

  return (
    <main className="admin-mobile-performance">
      <header className="admin-mobile-performance-header">
        <div>
          <h1>ADMIN</h1>
          <p>Station Performance</p>
        </div>
        <div className="admin-mobile-header-actions">
          <span>Updated {formatRefreshTime(lastRefreshedAt)}</span>
          <button type="button" className="admin-logout-button" onClick={logout}>Log Out</button>
        </div>
      </header>

      <nav className="admin-mobile-primary-nav" aria-label="Admin mobile categories">
        <button type="button" className={activeView === "performance" ? "active" : ""} onClick={() => selectView("performance")}>Performance</button>
        <button type="button" className={activeView === "corrections" ? "active" : ""} onClick={() => selectView("corrections")}>
          Corrections{correctionRequests.length ? ` (${correctionRequests.length})` : ""}
        </button>
      </nav>

      {activeView === "performance" && <>
      <section className="admin-mobile-performance-filters" aria-label="Performance filters">
        <Field label="Station">
          <SelectInput value={station} onChange={setStation} options={["All Stations", ...BRANCHES]} />
        </Field>
        <Field label="Report Date">
          <TextInput type="date" min={OWNER_ACCOUNTING_START_DATE} max={localDateKey()} value={anchorDate} onChange={setAnchorDate} />
        </Field>
        {period === "Shift" && (
          <Field label="Shift">
            <SelectInput value={shiftId} onChange={setShiftId} options={SHIFT_OPTIONS.map((shift) => ({ value: shift.id, label: shift.label }))} />
          </Field>
        )}
      </section>

      <div className="admin-mobile-performance-tabs" role="tablist" aria-label="Performance period">
        {MOBILE_PERFORMANCE_PERIODS.map((option) => (
          <button
            type="button"
            role="tab"
            aria-selected={period === option}
            className={period === option ? "active" : ""}
            key={option}
            onClick={() => setPeriod(option)}
          >
            {option === "Shift" ? "Shiftly" : option === "All-time" ? "All Time" : option}
          </button>
        ))}
      </div>

      <section className="admin-mobile-system-report" aria-label="System report mobile view">
        <div className="admin-mobile-system-report-head">
          <div>
            <span>System Report</span>
            <h2>{rangeLabel}</h2>
          </div>
          <small>{station}</small>
        </div>

        <div className="admin-mobile-system-report-totals">
          <article className="cash-on-hand">
            <span>Cash on Hand for Deposit</span>
            <strong>{peso(summary.pendingCashOnHand)}</strong>
            <small>Undeposited cash from submitted reports</small>
          </article>
          <article>
            <span>Latest Inventory Value</span>
            <strong>{peso(tankInventoryValue)}</strong>
            <small>Based on each station's last submitted tank log</small>
          </article>
          <article>
            <span>Total Deductions</span>
            <strong>{peso(summary.deductions)}</strong>
            <small>Includes cash vouchers and other deductions</small>
          </article>
        </div>

        <div className="admin-mobile-deduction-breakdown" aria-label="Cash voucher deduction breakdown">
          {CASH_VOUCHER_CATEGORIES.map((category) => (
            <div key={category}>
              <span>{category}</span>
              <strong>{peso(summary.cashVoucherCategories[category])}</strong>
            </div>
          ))}
        </div>

        <div className="admin-mobile-margin-table-wrap">
          <h3>Margin per Liter per Station</h3>
          <p>After ₱2/L discount; Liloan uses ₱3/L.</p>
          <table className="admin-mobile-margin-table">
            <thead><tr><th>Station</th>{FUEL_TYPES.map((product) => <th key={product}>{product}</th>)}</tr></thead>
            <tbody>
              {marginRows.map((row) => (
                <tr key={row.branch}>
                  <td>{row.branch}</td>
                  {FUEL_TYPES.map((product) => <td key={product}>{ownerPeso(row[product], "/L")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <PerformanceVolumeChart
        compact
        rows={trends.volume}
        average={averageDailyVolume}
        rangeLabel={rangeLabel}
      />

      <section className="admin-mobile-performance-kpis" aria-label="Performance totals">
        <PerformanceMetric index={1} title="Average Daily Volume" value={liter(averageDailyVolume)} rows={trends.volume} />
        <PerformanceMetric index={2} title="Tank Inventory Value" value={peso(tankInventoryValue)} note="Latest submitted dips" rows={[]} />
        <PerformanceMetric index={3} title="Total FuelTech Pay" value={peso(summary.fuelTechPayTotal)} rows={trends.fuelTechPay} />
        <PerformanceMetric index={4} title="Total PO" value={peso(summary.poTotal)} rows={trends.po} />
        <PerformanceMetric index={5} title="Fuel Redemption" value={peso(fuelRedemption)} rows={trends.fuelRedemption} />
        <PerformanceMetric index={6} title="Cash Redemption" value={peso(cashRedemption)} rows={trends.cashRedemption} />
        <PerformanceMetric index={7} title="Coke Used" value={`${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(summary.cokeSold)} pcs`} rows={trends.coke} />
        <PerformanceMetric index={8} title="System Points" value={new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(summary.pointsIssued)} rows={trends.points} />
        <PerformanceMetric index={9} title="Cash Vouchers" value={peso(summary.purchaseTotal)} rows={trends.cashVouchers} />
      </section>
      </>}

      {activeView === "corrections" && (
        <section className="admin-mobile-corrections" aria-label="Date correction approvals">
          <div className="admin-mobile-corrections-head">
            <div>
              <h2>Date Corrections</h2>
              <p>Review requests sent by cashiers.</p>
            </div>
            <strong>{correctionRequests.length}</strong>
          </div>

          <div className="admin-mobile-alert-settings">
            <div>
              <b>Phone alerts</b>
              <span>{notificationStatus || "Enable alerts once to receive new correction requests."}</span>
            </div>
            <button type="button" disabled={enablingNotifications} onClick={enableCorrectionNotifications}>
              {enablingNotifications ? "Enabling..." : "Enable Alerts"}
            </button>
          </div>

          <div className="admin-mobile-correction-list">
            {correctionRequests.length === 0 ? (
              <div className="admin-mobile-correction-empty">
                <b>No correction requests</b>
                <span>New requests will appear here.</span>
              </div>
            ) : correctionRequests.map((requestReport) => {
              const request = correctionRequest(requestReport);
              const expired = request.status === "approved" && !isActiveCorrectionApproval(requestReport);
              return (
                <article className="admin-mobile-correction-card" key={`${requestReport.branch}-${requestReport.date}-${requestReport.shiftId}-${request.id || "correction"}`}>
                  <div className="admin-mobile-correction-title">
                    <div>
                      <span>{requestReport.branch}</span>
                      <strong>{request.reportDate || requestReport.date}</strong>
                    </div>
                    <b className={request.status === "approved" && !expired ? "approved" : "pending"}>{expired ? "Expired" : request.status}</b>
                  </div>
                  <dl>
                    <div><dt>Shift</dt><dd>{shiftById(request.shiftId || requestReport.shiftId).label}</dd></div>
                    <div><dt>Reason</dt><dd>{request.reason || "No reason entered"}</dd></div>
                    <div><dt>Requested</dt><dd>{request.requestedAt ? new Date(request.requestedAt).toLocaleString("en-PH") : "Not recorded"}</dd></div>
                  </dl>
                  <div className="admin-mobile-correction-actions">
                    <button type="button" className="reject" onClick={() => rejectCorrectionRequest(requestReport)}>Reject</button>
                    <button type="button" className="approve" disabled={request.status === "approved" && !expired} onClick={() => approveCorrectionRequest(requestReport)}>
                      {request.status === "approved" && !expired ? "Approved" : "Approve"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}

function OwnerFuelTable({ rows, average }) {
  const averageRow = average ? {
    label: "Average",
    Premium: ownerAverage(rows, "Premium"),
    Regular: ownerAverage(rows, "Regular"),
    Diesel: ownerAverage(rows, "Diesel"),
  } : null;
  const displayRows = averageRow ? [...rows, averageRow] : rows;
  return (
    <div className="owner-table-wrap">
      <table className="owner-fuel-table">
        <thead>
          <tr>
            <th>Station</th>
            {FUEL_TYPES.map((product) => <th key={product}>{product}</th>)}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row) => (
            <tr key={row.branch || row.label} className={row.label === "Average" ? "owner-total-row" : ""}>
              <td>{row.label}</td>
              {FUEL_TYPES.map((product) => <td key={product}>{ownerPeso(row[product])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OwnerValueList({ rows, total }) {
  return (
    <div className="owner-value-list">
      {rows.map((row) => (
        <div className="owner-value-row" key={row.branch}>
          <span>{row.label}</span>
          <strong>{peso(row.value)}</strong>
        </div>
      ))}
      <div className="owner-value-row owner-total-row">
        <span>Grand total</span>
        <strong>{peso(total)}</strong>
      </div>
    </div>
  );
}

function MobileAdminPanel({ logout, sessionToken, branch, selectedDate, selectedShiftId, lastRefreshedAt, priceBook, allReports, report, result, reviewFlags, adminSummary, adminSummaryReports, adminInsights, mobileStationBranch, setMobileStationBranch, mobileStationStartDate, setMobileStationStartDate, mobileStationEndDate, setMobileStationEndDate, mobileStationSummary, healthRows, healthCounts, depositCounts, correctionRequests, approveCorrectionRequest, rejectCorrectionRequest, rankingRows, consolidatedDeposits, verifyDeposit, approveDepositRemoval, rejectDepositRemoval, weeklyCashFlow, monthlyCashFlow, summaryStartDate, setSummaryStartDate, summaryEndDate, setSummaryEndDate, exportDailyBackup, systemHealth }) {
  return <AdminMobilePerformance logout={logout} sessionToken={sessionToken} lastRefreshedAt={lastRefreshedAt} priceBook={priceBook} allReports={allReports} correctionRequests={correctionRequests} approveCorrectionRequest={approveCorrectionRequest} rejectCorrectionRequest={rejectCorrectionRequest} />;

  const [activeCategory, setActiveCategory] = useState("overview");
  const system = systemHealthSummary(systemHealth);
  const urgentCount = n(healthCounts.Missing) + n(healthCounts["Check Required"]) + n(depositCounts["Deposit Missing"]) + correctionRequests.length;
  const pendingDeposits = consolidatedDeposits.filter(({ deposit }) => !deposit.verified && !isRemovalRequested(deposit)).length;
  const removalRequests = consolidatedDeposits.filter(({ deposit }) => isRemovalRequested(deposit)).length;
  const pendingDepositAmount = consolidatedDeposits
    .filter(({ deposit }) => !deposit.verified && !isRemovalRequested(deposit))
    .reduce((sum, { deposit }) => sum + n(deposit.amount), 0);
  const verifiedDepositAmount = consolidatedDeposits
    .filter(({ deposit }) => deposit.verified && !isRemovalRequested(deposit))
    .reduce((sum, { deposit }) => sum + n(deposit.amount), 0);
  const topStation = rankingRows[0];
  const watchStation = rankingRows[rankingRows.length - 1];
  const reportTone = report.confirmed ? (reviewFlags.length ? "warning" : "good") : "warning";
  const weeklyTone = n(weeklyCashFlow) < 0 ? "bad" : "good";
  const monthlyTone = n(monthlyCashFlow) < 0 ? "bad" : "good";
  const selectedCashVariance = report.confirmed ? result.cashVariance : 0;
  const categories = [
    { id: "overview", label: "Overview" },
    { id: "cash", label: "Cash Flow" },
    { id: "reports", label: "Reports" },
    { id: "deposits", label: "Deposits" },
    { id: "stations", label: "Stations" },
    { id: "consolidated", label: "Consolidated" },
    { id: "backup", label: "Backup" },
  ];

  return (
    <div className="mobile-admin-panel">
      <div className="mobile-admin-hero">
        <span>Admin Menu</span>
        <h2>FuelTech Accounting</h2>
        <p>{selectedDate} - {branch}</p>
      </div>

      <div className="mobile-admin-tabs" aria-label="Admin mobile categories">
        {categories.map((category) => (
          <button
            key={category.id}
            className={activeCategory === category.id ? "active" : ""}
            onClick={() => setActiveCategory(category.id)}
            type="button"
          >
            {category.label}
          </button>
        ))}
      </div>

      {activeCategory === "overview" && (
        <MobileAdminSection title="Overview">
          <div className="mobile-admin-grid">
            <MobileAdminMetric label="Needs Attention" value={`${urgentCount}`} note="Reports, deposits, corrections" tone={urgentCount ? "bad" : "good"} />
            <MobileAdminMetric label="Selected Report" value={report.confirmed ? "Submitted" : "Draft"} note={report.confirmed ? reviewFlags.join(", ") || "Normal" : "Shows zero until submitted"} tone={reportTone} />
          </div>
          <MobileAdminRow label="Cash Variance" value={peso(selectedCashVariance)} note={report.confirmed ? "Submitted report" : "Draft report"} tone={n(selectedCashVariance) < 0 ? "bad" : "neutral"} />
          <MobileLineChart title="Sales Trend" rows={adminInsights.dailySales} />
          <MobileMiniBarChart title="Best Shift Sales" rows={adminInsights.shiftSales} />
          <MobileMiniBarChart title="Best Product Sales" rows={adminInsights.productSales} />
          <MobileMiniBarChart title="Station Sales" rows={adminInsights.stationSales} />
        </MobileAdminSection>
      )}

      {activeCategory === "cash" && (
        <MobileAdminSection title="Cash Flow">
          <MobileCashFlowGraph weeklyCashFlow={weeklyCashFlow} monthlyCashFlow={monthlyCashFlow} />
          <div className="mobile-admin-grid">
            <MobileAdminMetric label="This Week" value={peso(weeklyCashFlow)} note={cashFlowLabel(weeklyCashFlow)} tone={weeklyTone} />
            <MobileAdminMetric label="This Month" value={peso(monthlyCashFlow)} note={cashFlowLabel(monthlyCashFlow)} tone={monthlyTone} />
          </div>
          <MobileAdminRow label="Selected Cash Variance" value={peso(selectedCashVariance)} note={report.confirmed ? "Submitted report only" : "Draft report"} tone={n(selectedCashVariance) < 0 ? "bad" : "neutral"} />
        </MobileAdminSection>
      )}

      {activeCategory === "reports" && (
        <MobileAdminSection title="Reports">
          <MobileAdminRow label="Submitted" value={`${n(healthCounts.Submitted)}`} note="Current health range" tone="good" />
          <MobileAdminRow label="Missing" value={`${n(healthCounts.Missing)}`} note="Needs follow-up" tone={n(healthCounts.Missing) ? "bad" : "good"} />
          <MobileAdminRow label="Check Required" value={`${n(healthCounts["Check Required"])}`} note="High variance or reading issue" tone={n(healthCounts["Check Required"]) ? "warning" : "good"} />
          <MobileStationHealthMatrix healthRows={healthRows} />
        </MobileAdminSection>
      )}

      {activeCategory === "deposits" && (
        <MobileAdminSection title="Deposits">
          <MobileAdminRow label="Deposit Missing" value={`${n(depositCounts["Deposit Missing"])}`} note="Submitted report without deposit" tone={n(depositCounts["Deposit Missing"]) ? "bad" : "good"} />
          <MobileAdminRow label="Pending Verification" value={`${pendingDeposits}`} note="Bank deposits to verify" tone={pendingDeposits ? "warning" : "good"} />
          <MobileAdminRow label="Pending Amount" value={peso(pendingDepositAmount)} note="Needs admin verification" tone={pendingDepositAmount ? "warning" : "good"} />
          <MobileAdminRow label="Verified Amount" value={peso(verifiedDepositAmount)} note="Already approved by admin" tone="good" />
          <MobileAdminRow label="Removal Requests" value={`${removalRequests}`} note="Manager asks admin approval" tone={removalRequests ? "warning" : "good"} />
          <MobileDepositApprovalList
            consolidatedDeposits={consolidatedDeposits}
            verifyDeposit={verifyDeposit}
            approveDepositRemoval={approveDepositRemoval}
            rejectDepositRemoval={rejectDepositRemoval}
          />
        </MobileAdminSection>
      )}

      {activeCategory === "stations" && (
        <MobileAdminSection title="Stations">
          <MobileStationBars rankingRows={rankingRows} />
          <MobileAdminRow label="Reports Included" value={`${adminSummaryReports.length}`} note="Submitted reports in summary range" />
          <MobileAdminRow label="Best Station" value={topStation?.branch || "None"} note={topStation ? `${topStation.submitted} submitted` : "No submitted reports"} tone="good" />
          <MobileAdminRow label="Watch Station" value={watchStation?.branch || "None"} note={watchStation ? `${watchStation.depositMissing} missing deposits` : "No submitted reports"} tone={watchStation?.depositMissing ? "warning" : "neutral"} />
        </MobileAdminSection>
      )}

      {activeCategory === "consolidated" && (
        <MobileAdminSection title="Consolidated Summary">
          <div className="mobile-filter-grid">
            <Field label="From"><TextInput type="date" value={summaryStartDate} onChange={setSummaryStartDate} /></Field>
            <Field label="To"><TextInput type="date" value={summaryEndDate} onChange={setSummaryEndDate} /></Field>
          </div>
          <MobileAdminRow label="Gross Sales" value={peso(adminSummary.grossSales)} />
          <MobileAdminRow label="Total Liters Sold" value={liter(adminSummary.totalLiters)} />
          <MobileAdminRow label="Premium Liters" value={liter(adminSummary.fuelLiters.Premium)} />
          <MobileAdminRow label="Regular Liters" value={liter(adminSummary.fuelLiters.Regular)} />
          <MobileAdminRow label="Diesel Liters" value={liter(adminSummary.fuelLiters.Diesel)} />
          <MobileAdminRow label="Expected Cash" value={peso(adminSummary.expectedCash)} />
          <MobileAdminRow label="Bank Deposit" value={peso(adminSummary.bankDeposit)} />
          <MobileAdminRow label="Confirmed Bank" value={peso(adminSummary.confirmedBank)} tone="good" />
          <MobileAdminRow label="Pending Bank" value={peso(adminSummary.pendingBank)} tone={n(adminSummary.pendingBank) ? "warning" : "good"} />
          <MobileAdminRow label="Cash Variance" value={peso(adminSummary.cashVariance)} tone={n(adminSummary.cashVariance) < 0 ? "bad" : "neutral"} />
          <MobileMiniBarChart
            title="Liters by Product"
            rows={FUEL_TYPES.map((product) => ({ label: product, value: adminSummary.fuelLiters[product] }))}
            formatValue={liter}
          />
          <div className="mobile-subsection-title">Station Summary</div>
          <div className="mobile-filter-grid">
            <Field label="Station"><SelectInput value={mobileStationBranch} onChange={setMobileStationBranch} options={BRANCHES} /></Field>
            <Field label="From"><TextInput type="date" value={mobileStationStartDate} onChange={setMobileStationStartDate} /></Field>
            <Field label="To"><TextInput type="date" value={mobileStationEndDate} onChange={setMobileStationEndDate} /></Field>
          </div>
          <MobileAdminRow label={`${mobileStationBranch} Gross Sales`} value={peso(mobileStationSummary.grossSales)} />
          <MobileAdminRow label="Total Liters Sold" value={liter(mobileStationSummary.totalLiters)} />
          <MobileAdminRow label="Premium Liters" value={liter(mobileStationSummary.fuelLiters.Premium)} />
          <MobileAdminRow label="Regular Liters" value={liter(mobileStationSummary.fuelLiters.Regular)} />
          <MobileAdminRow label="Diesel Liters" value={liter(mobileStationSummary.fuelLiters.Diesel)} />
          <MobileAdminRow label="Cash Variance" value={peso(mobileStationSummary.cashVariance)} tone={n(mobileStationSummary.cashVariance) < 0 ? "bad" : "neutral"} />
        </MobileAdminSection>
      )}

      {activeCategory === "backup" && (
        <MobileAdminSection title="System Health">
          <MobileAdminRow label="Nightly Backup" value={system.backupStatus} note={`${system.backupDate} · ${system.backupReports} reports`} tone={system.backupTone} />
          <MobileAdminRow label="Daily Report Check" value={system.healthStatus} note={system.healthDate} tone={system.healthTone} />
          <MobileAdminRow label="Missing Reports" value={`${system.missingReports}`} note="From last daily check" tone={system.missingReports ? "bad" : "good"} />
          <MobileAdminRow label="Missing Deposits" value={`${system.missingDeposits}`} note={`${system.pendingDeposits} pending verification`} tone={system.missingDeposits ? "bad" : system.pendingDeposits ? "warning" : "good"} />
          <MobileAdminRow label="Checked Cash Variance" value={peso(system.cashVariance)} tone={n(system.cashVariance) < 0 ? "bad" : "neutral"} />
          {system.error && <div className="warning-box">{system.error}</div>}
          {system.setupNeeded && <div className="warning-box">System health setup is almost ready. Run the Supabase hardening SQL once so backup and health records can be saved.</div>}
          <button type="button" className="mobile-admin-button" onClick={() => exportDailyBackup(selectedDate)}>Backup Selected Date</button>
        </MobileAdminSection>
      )}
    </div>
  );
}

function AdminPage({ logout, sessionToken, branch, setBranch, selectedDate, setSelectedDate, selectedShiftId, setSelectedShiftId, lastRefreshedAt, report, result, priceBook, allReports, patchFuelDeliveryCosts, verifyDeposit, approveDepositRemoval, rejectDepositRemoval, correctionRequests, missingShiftActivities, approveCorrectionRequest, rejectCorrectionRequest, summaryStartDate, setSummaryStartDate, summaryEndDate, setSummaryEndDate, adminSummaryReports, adminSummary, adminInsights, mobileStationBranch, setMobileStationBranch, mobileStationStartDate, setMobileStationStartDate, mobileStationEndDate, setMobileStationEndDate, mobileStationSummary, consolidatedDeposits, exportDailyBackup, systemHealth, healthStartDate, setHealthStartDate, healthEndDate, setHealthEndDate, healthRows, healthCounts, depositRows, depositCounts, rankingRange, setRankingRange, rankingRows, rankingReportCount, weeklyCashFlow, monthlyCashFlow }) {
  const visibleDeposits = report.confirmed ? activeDeposits(report) : [];
  const reviewFlags = reportReviewFlags(report, result);
  const depositReferenceLabel = branch === "Liloan" ? "Minutes and Seconds" : "Reference";
  const system = systemHealthSummary(systemHealth);
  const zeroStationResult = {
    fuelSales: 0,
    grossSales: 0,
    deductionTotal: 0,
    pointsIssued: 0,
    pointsWithdrawn: 0,
    expectedCash: 0,
    bankDeposit: 0,
    confirmedBank: 0,
    pendingBank: 0,
    pendingCashOnHand: 0,
    poTotal: 0,
    purchaseTotal: 0,
    cashVariance: 0,
    pumpVariance: 0,
    tankVariance: 0,
    fuelLiters: { Premium: 0, Regular: 0, Diesel: 0 },
    totalLiters: 0,
    cokeSold: 0,
  };
  const stationResult = report.confirmed ? result : zeroStationResult;
  const stationOilSales = report.confirmed ? report.oilSales : 0;
  const [stationSummaryStartDate, setStationSummaryStartDate] = useState(selectedDate);
  const [stationSummaryEndDate, setStationSummaryEndDate] = useState(selectedDate);
  const [stationSummaryMode, setStationSummaryMode] = useState("Daily");
  const [stationSummaryShiftId, setStationSummaryShiftId] = useState(selectedShiftId);
  const stationSummaryReports = useMemo(() => {
    const dates = datesBetween(stationSummaryStartDate, stationSummaryEndDate);
    const shifts = stationSummaryMode === "Shift" ? SHIFT_OPTIONS.filter((shift) => shift.id === stationSummaryShiftId) : SHIFT_OPTIONS;
    return dates.flatMap((date) =>
      shifts.map((shift) => allReports[reportKey(branch, date, shift.id)]).filter((item) => item?.confirmed)
    );
  }, [allReports, branch, stationSummaryMode, stationSummaryShiftId, stationSummaryStartDate, stationSummaryEndDate]);
  const stationSummaryResult = useMemo(() => summarizeReports(stationSummaryReports), [stationSummaryReports]);
  const adminFuelDeliveryRows = useMemo(() => fuelDeliveryCostRows(allReports, priceBook), [allReports, priceBook]);
  const [selectedFuelDeliveryKey, setSelectedFuelDeliveryKey] = useState("");
  const selectedFuelDelivery = adminFuelDeliveryRows.find((row) => row.key === selectedFuelDeliveryKey) || adminFuelDeliveryRows[0] || null;
  const [fuelCostDraft, setFuelCostDraft] = useState(() => ({
    branch,
    date: selectedDate,
    shiftId: selectedShiftId,
    costs: defaultFuelCosts(),
  }));
  const [fuelCostSaving, setFuelCostSaving] = useState(false);
  const [fuelCostConfirmedAt, setFuelCostConfirmedAt] = useState("");
  const selectedFuelCostBranch = selectedFuelDelivery?.branch || branch;
  const selectedFuelCostDate = selectedFuelDelivery?.date || selectedDate;
  const selectedFuelCostShiftId = selectedFuelDelivery?.shiftId || selectedShiftId;
  const adminCostPricing = getEffectiveDailyPricing(priceBook || {}, selectedFuelCostBranch, selectedFuelCostDate);
  const adminCostPrices = { ...defaultPrices(), ...defaultFuelCosts(), ...adminCostPricing.prices };
  const adminDeliveryLiters = selectedFuelDelivery?.deliveryLiters || defaultPrices();
  const hasAnyAdminDelivery = Boolean(selectedFuelDelivery) && FUEL_TYPES.some((product) => n(adminDeliveryLiters[product]) > 0);
  const adminCostMeta = adminCostPrices.fuelDeliveryCostMeta || {};
  const selectedFuelDeliveryConfirmed = Boolean(fuelCostConfirmedAt || selectedFuelDelivery?.confirmed);
  const selectedFuelDeliveryConfirmedNote = fuelCostConfirmedAt || (selectedFuelDelivery?.confirmed ? adminCostMeta.confirmedAt : "Press confirm after editing costs.");
  useEffect(() => {
    if (!adminFuelDeliveryRows.length) {
      if (selectedFuelDeliveryKey) setSelectedFuelDeliveryKey("");
      return;
    }
    if (!selectedFuelDeliveryKey || !adminFuelDeliveryRows.some((row) => row.key === selectedFuelDeliveryKey)) {
      setSelectedFuelDeliveryKey(adminFuelDeliveryRows[0].key);
    }
  }, [adminFuelDeliveryRows, selectedFuelDeliveryKey]);
  useEffect(() => {
    if (!selectedFuelDelivery) return;
    setFuelCostDraft((old) => ({
      ...old,
      branch: selectedFuelDelivery.branch,
      date: selectedFuelDelivery.date,
      shiftId: selectedFuelDelivery.shiftId,
      costs: fuelCostValuesFromPrices(adminCostPrices),
    }));
  }, [
    selectedFuelDelivery?.key,
    adminCostPrices.PremiumCost,
    adminCostPrices.RegularCost,
    adminCostPrices.DieselCost,
  ]);
  useEffect(() => {
    setFuelCostConfirmedAt("");
  }, [selectedFuelDelivery?.key]);
  function patchFuelCostDraft(product, value) {
    setFuelCostConfirmedAt("");
    setFuelCostDraft((old) => ({
      ...old,
      costs: { ...(old.costs || defaultFuelCosts()), [fuelCostKey(product)]: value },
    }));
  }
  async function confirmFuelDeliveryCosts() {
    if (!selectedFuelDelivery) return;
    setFuelCostSaving(true);
    try {
      await patchFuelDeliveryCosts({
        deliveryBranch: selectedFuelDelivery.branch,
        deliveryDate: selectedFuelDelivery.date,
        deliveryShiftId: selectedFuelDelivery.shiftId,
        costs: { ...defaultFuelCosts(), ...(fuelCostDraft.costs || {}) },
      });
      setFuelCostConfirmedAt(new Date().toLocaleString());
    } finally {
      setFuelCostSaving(false);
    }
  }
  const [activeDesktopCategory, setActiveDesktopCategory] = useState("overview");
  const [reportExportStartDate, setReportExportStartDate] = useState("2026-07-29");
  const [reportExportEndDate, setReportExportEndDate] = useState(TODAY);
  const [reportExportMessage, setReportExportMessage] = useState("");
  const [performanceBranch, setPerformanceBranch] = useState("All Stations");
  const [performancePeriod, setPerformancePeriod] = useState("Daily");
  const [performanceDate, setPerformanceDate] = useState(selectedDate);
  const [performanceShiftId, setPerformanceShiftId] = useState(selectedShiftId);
  const [restoreTest, setRestoreTest] = useState({ loading: false, result: null, error: "" });
  const performanceRange = ownerPeriodRange(performancePeriod, performanceDate, MISSING_SHIFT_WARNING_START_DATE);
  const performanceReports = useMemo(() => Object.values(allReports).filter((item) => (
    item?.confirmed
    && item.date >= performanceRange.start
    && item.date <= performanceRange.end
    && (performanceBranch === "All Stations" || item.branch === performanceBranch)
    && (performancePeriod !== "Shift" || item.shiftId === performanceShiftId)
  )), [allReports, performanceBranch, performanceDate, performancePeriod, performanceShiftId]);
  const performanceSummary = useMemo(() => summarizeReports(performanceReports), [performanceReports]);
  const performanceMargin = useMemo(() => fuelMarginForReports(performanceReports, priceBook), [performanceReports, priceBook]);
  const performanceRows = useMemo(() => BRANCHES.map((station) => {
    const reports = performanceReports.filter((item) => item.branch === station);
    return { station, reports, summary: summarizeReports(reports), margin: fuelMarginForReports(reports, priceBook) };
  }).filter((row) => row.reports.length), [performanceReports, priceBook]);
  const performanceTrendBranches = performanceBranch === "All Stations" ? BRANCHES : [performanceBranch];
  const performanceTrendShifts = SHIFT_OPTIONS.map((shift) => ({ id: shift.id, shortLabel: shortShiftLabel(shift.id) }));
  const performanceMetricTrends = useMemo(() => {
    const trend = (valueForReport) => ownerCashTrendRows(
      performanceReports,
      performancePeriod,
      performanceRange,
      valueForReport,
      performanceTrendBranches,
      performanceTrendShifts,
    );
    return {
      volume: trend((item) => compute(item).totalLiters),
      fuelTechPay: trend((item) => fuelTechPayTotal(item.deductions)),
      po: trend((item) => compute(item).poTotal),
      fuelRedemption: trend((item) => n(item.deductions?.fuelRedemption)),
      cashRedemption: trend((item) => n(item.deductions?.cashRedemption)),
      coke: trend((item) => compute(item).cokeSold),
      points: trend((item) => compute(item).pointsIssued),
      cashVouchers: trend((item) => compute(item).purchaseTotal),
    };
  }, [performanceReports, performancePeriod, performanceRange.start, performanceRange.end, performanceBranch]);
  const performanceDayCount = new Set(performanceReports.map((item) => item.date)).size;
  const performanceAverageDailyVolume = performanceDayCount ? performanceSummary.totalLiters / performanceDayCount : 0;
  const performanceTankValue = useMemo(() => {
    const eligibleReports = Object.values(allReports).filter((item) =>
      item?.confirmed
      && item.date <= performanceRange.end
      && (performanceBranch === "All Stations" || item.branch === performanceBranch)
    );
    const latestReports = latestConfirmedReportsByBranch(eligibleReports);
    return Object.values(latestReports).reduce((total, item) => {
      const prices = ownerPricesForBranch(priceBook, item.branch, item.date, item.shiftId);
      return total + ownerTankValue(item, prices);
    }, 0);
  }, [allReports, performanceBranch, performanceRange.end, priceBook]);
  const performanceFuelRedemption = performanceReports.reduce((sum, item) => sum + n(item.deductions?.fuelRedemption), 0);
  const performanceCashRedemption = performanceReports.reduce((sum, item) => sum + n(item.deductions?.cashRedemption), 0);
  async function testLatestBackupRestore() {
    setRestoreTest({ loading: true, result: null, error: "" });
    try {
      const result = await runBackupRestoreTest(sessionToken);
      setRestoreTest({ loading: false, result, error: "" });
    } catch (error) {
      setRestoreTest({ loading: false, result: null, error: error.message || "Backup restoration test failed." });
    }
  }
  function downloadReportExport(exportAll = false) {
    const completedReports = Object.values(allReports).filter((item) => item && reportCompleted(item));
    if (!completedReports.length) {
      setReportExportMessage("No completed reports are available to export.");
      return;
    }

    const savedDates = completedReports.map((item) => item.date).sort();
    const exportStart = exportAll ? savedDates[0] : reportExportStartDate;
    const exportEnd = exportAll ? savedDates[savedDates.length - 1] : reportExportEndDate;
    if (!exportStart || !exportEnd || exportStart > exportEnd) {
      setReportExportMessage("Please choose a valid From and To date.");
      return;
    }

    const reports = completedReports.filter((item) => item.date >= exportStart && item.date <= exportEnd);
    if (!reports.length) {
      setReportExportMessage("No completed reports were found in that date range.");
      return;
    }

    exportDetailedReportsToExcel(reports, summarizeReports(reports), exportStart, exportEnd);
    setReportExportMessage(`${reports.length} completed report${reports.length === 1 ? "" : "s"} downloaded to Excel.`);
  }
  const [healthBranch, setHealthBranch] = useState("All Stations");
  const filteredHealthRows = useMemo(() => (
    healthBranch === "All Stations" ? healthRows : healthRows.filter((row) => row.branch === healthBranch)
  ), [healthRows, healthBranch]);
  const filteredHealthCounts = useMemo(() => stationHealthCounts(filteredHealthRows), [filteredHealthRows]);
  const filteredDepositRows = useMemo(() => (
    healthBranch === "All Stations" ? depositRows : depositRows.filter((row) => row.branch === healthBranch)
  ), [depositRows, healthBranch]);
  const filteredDepositCounts = useMemo(() => statusCounts(filteredDepositRows), [filteredDepositRows]);
  const priceChangeRows = useMemo(() => priceChangeHistoryRows(allReports, priceBook), [allReports, priceBook]);
  const cashReconciliationRows = useMemo(() => actualCashReconciliationRows(allReports), [allReports]);
  const cashShortageRows = cashReconciliationRows.filter((row) => row.status === "Shortage");
  const cashOverageRows = cashReconciliationRows.filter((row) => row.status === "Overage");
  const visibleCashAlertRows = cashReconciliationRows.filter((row) => row.status !== "Within Limit");
  const totalCashShortage = cashShortageRows.reduce((sum, row) => sum + Math.abs(row.difference), 0);
  const totalCashOverage = cashOverageRows.reduce((sum, row) => sum + row.difference, 0);
  const [reportBrowserBranch, setReportBrowserBranch] = useState("All Stations");
  const [reportBrowserStartDate, setReportBrowserStartDate] = useState("2026-07-29");
  const [reportBrowserEndDate, setReportBrowserEndDate] = useState(TODAY);
  const [reportBrowserShift, setReportBrowserShift] = useState("All Shifts");
  const [reportBrowserStatus, setReportBrowserStatus] = useState("All Reports");
  const [selectedAdminReportKey, setSelectedAdminReportKey] = useState("");
  const [copiedReviewMessageKey, setCopiedReviewMessageKey] = useState("");
  const reportCarouselRef = useRef(null);
  const adminReportCards = useMemo(() => Object.values(allReports)
    .filter((item) => {
      if (!item || !reportCompleted(item)) return false;
      if (item.date < reportBrowserStartDate || item.date > reportBrowserEndDate) return false;
      if (reportBrowserBranch !== "All Stations" && item.branch !== reportBrowserBranch) return false;
      if (reportBrowserShift !== "All Shifts" && item.shiftId !== reportBrowserShift) return false;
      const flags = reportReviewFlags(item, compute(item));
      if (reportBrowserStatus === "Opening Setup") return openingSetupCompleted(item);
      if (reportBrowserStatus === "Check Required") return !openingSetupCompleted(item) && flags.length > 0;
      if (reportBrowserStatus === "Normal") return !openingSetupCompleted(item) && flags.length === 0;
      return true;
    })
    .sort((left, right) => (
      right.date.localeCompare(left.date)
      || SHIFT_OPTIONS.findIndex((shift) => shift.id === right.shiftId) - SHIFT_OPTIONS.findIndex((shift) => shift.id === left.shiftId)
      || left.branch.localeCompare(right.branch)
    )), [allReports, reportBrowserBranch, reportBrowserEndDate, reportBrowserShift, reportBrowserStartDate, reportBrowserStatus]);
  useEffect(() => {
    if (!adminReportCards.length) {
      if (selectedAdminReportKey) setSelectedAdminReportKey("");
      return;
    }
    if (!selectedAdminReportKey || !adminReportCards.some((item) => reportKey(item.branch, item.date, item.shiftId) === selectedAdminReportKey)) {
      setSelectedAdminReportKey(reportKey(adminReportCards[0].branch, adminReportCards[0].date, adminReportCards[0].shiftId));
    }
  }, [adminReportCards, selectedAdminReportKey]);
  const selectedAdminReport = adminReportCards.find((item) => reportKey(item.branch, item.date, item.shiftId) === selectedAdminReportKey) || adminReportCards[0] || null;
  const selectedAdminReportResult = selectedAdminReport ? compute(selectedAdminReport) : null;
  const selectedAdminReportFlags = selectedAdminReport && selectedAdminReportResult
    ? reportReviewFlags(selectedAdminReport, selectedAdminReportResult)
    : [];
  const selectedAdminReviewMessage = selectedAdminReport && selectedAdminReportResult && selectedAdminReportFlags.length
    ? buildReviewMessage({
      cashierName: selectedAdminReport.cashierName,
      branch: selectedAdminReport.branch,
      date: selectedAdminReport.date,
      shiftLabel: shiftById(selectedAdminReport.shiftId).label,
      expectedCash: selectedAdminReportResult.expectedCash,
      actualCashCounted: selectedAdminReportResult.actualCashCounted,
      actualCashCountEntered: selectedAdminReportResult.actualCashCountEntered,
      cashVariance: selectedAdminReportResult.cashVariance,
      flags: selectedAdminReportFlags,
    })
    : "";
  const selectedAdminReportDeductions = selectedAdminReport ? [
    ...(fuelTechPayTotal(selectedAdminReport.deductions) > 0 ? [{ id: "fueltech-pay", label: "FuelTech Pay Total", amount: fuelTechPayTotal(selectedAdminReport.deductions) }] : []),
    ...visibleDeductionEntries(selectedAdminReport.deductions)
      .filter(([, amount]) => n(amount) !== 0)
      .map(([key, amount]) => ({ id: `deduction-${key}`, label: deductionLabel(key), amount: n(amount) })),
    ...(selectedAdminReport.poRows || []).map((row, index) => ({ id: row.id || `po-${index}`, label: `PO - ${row.account || row.particular || "Account"}`, amount: n(row.amount) })),
  ] : [];
  const selectedAdminReportCashVouchers = selectedAdminReport
    ? (selectedAdminReport.purchaseRows || []).map((row, index) => ({
      id: row.id || `cash-voucher-${index}`,
      category: row.category || "Uncategorized",
      particular: row.item || row.particular || row.account || "Not recorded",
      amount: n(row.amount),
    }))
    : [];
  const selectedAdminMidShiftSales = selectedAdminReport ? midShiftSalesBreakdown(selectedAdminReport) : [];
  const selectedAdminMidShiftReadings = selectedAdminReport ? midShiftReadingRows(selectedAdminReport) : [];
  function scrollAdminReportCards(direction) {
    reportCarouselRef.current?.scrollBy({ left: direction * 360, behavior: "smooth" });
  }
  function openSelectedAdminReport() {
    if (!selectedAdminReport) return;
    setBranch(selectedAdminReport.branch);
    setSelectedDate(selectedAdminReport.date);
    setSelectedShiftId(selectedAdminReport.shiftId);
    setActiveDesktopCategory("overview");
  }
  async function copySelectedReviewMessage() {
    if (!selectedAdminReviewMessage || !selectedAdminReportKey) return;
    try {
      await navigator.clipboard.writeText(selectedAdminReviewMessage);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = selectedAdminReviewMessage;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopiedReviewMessageKey(selectedAdminReportKey);
    window.setTimeout(() => setCopiedReviewMessageKey(""), 1800);
  }
  const desktopCategories = [
    { id: "overview", label: "Overview" },
    { id: "reports", label: "Reports" },
    { id: "performance", label: "Performance" },
    { id: "fuel-costs", label: "Fuel Costs" },
    { id: "price-history", label: "Price History" },
    { id: "corrections", label: "Corrections" },
    { id: "station-health", label: "Station Health" },
    { id: "deposit-health", label: "Deposit Health" },
    { id: "summary", label: "Station Summary" },
    { id: "consolidated", label: "Consolidated" },
    { id: "ranking", label: "Ranking" },
  ];

  return (
    <div className="admin-dashboard-shell">
      <AdminControlStrip
        logout={logout}
        branch={branch}
        setBranch={setBranch}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        selectedShiftId={selectedShiftId}
        setSelectedShiftId={setSelectedShiftId}
        lastRefreshedAt={lastRefreshedAt}
      />
      <div className="admin-mobile-only">
        <MobileAdminPanel
          logout={logout}
          sessionToken={sessionToken}
          branch={branch}
          selectedDate={selectedDate}
          selectedShiftId={selectedShiftId}
          lastRefreshedAt={lastRefreshedAt}
          priceBook={priceBook}
          allReports={allReports}
          report={report}
          result={result}
          reviewFlags={reviewFlags}
          adminSummary={adminSummary}
          adminSummaryReports={adminSummaryReports}
          adminInsights={adminInsights}
          mobileStationBranch={mobileStationBranch}
          setMobileStationBranch={setMobileStationBranch}
          mobileStationStartDate={mobileStationStartDate}
          setMobileStationStartDate={setMobileStationStartDate}
          mobileStationEndDate={mobileStationEndDate}
          setMobileStationEndDate={setMobileStationEndDate}
          mobileStationSummary={mobileStationSummary}
          healthRows={healthRows}
          healthCounts={healthCounts}
          depositCounts={depositCounts}
          correctionRequests={correctionRequests}
          approveCorrectionRequest={approveCorrectionRequest}
          rejectCorrectionRequest={rejectCorrectionRequest}
          rankingRows={rankingRows}
          consolidatedDeposits={consolidatedDeposits}
          verifyDeposit={verifyDeposit}
          approveDepositRemoval={approveDepositRemoval}
          rejectDepositRemoval={rejectDepositRemoval}
          weeklyCashFlow={weeklyCashFlow}
          monthlyCashFlow={monthlyCashFlow}
          summaryStartDate={summaryStartDate}
          setSummaryStartDate={setSummaryStartDate}
          summaryEndDate={summaryEndDate}
          setSummaryEndDate={setSummaryEndDate}
          exportDailyBackup={exportDailyBackup}
          systemHealth={systemHealth}
        />
      </div>

      <div className="admin-desktop-only">
      <div className="admin-desktop-shell">
        <aside className="admin-desktop-rail" aria-label="Admin desktop categories">
          <div className="admin-rail-brand">
            <span>FuelTech</span>
            <strong>Admin</strong>
          </div>
          {desktopCategories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={activeDesktopCategory === category.id ? "active" : ""}
              onClick={() => setActiveDesktopCategory(category.id)}
            >
              {category.label}
            </button>
          ))}
        </aside>
        <div className="admin-desktop-content">
      {activeDesktopCategory === "overview" && (
      <Section id="admin-section-overview" title="Admin View">
        <div className="grid four">
          <Card title="Selected Branch" value={branch} tone="dark" />
          <Card title="Selected Date" value={selectedDate} />
          <Card title="Pricing Used" value={report.pricingCoverage || "Daily"} note={report.pricingCoverage === "Shift" ? shiftById(report.pricingShiftId).label : report.pricingEffectiveDate ? `Effective ${report.pricingEffectiveDate}` : "Daily carry-forward"} />
          <Card title="Report Status" value={report.confirmed ? "Submitted" : "Draft"} tone={report.confirmed ? "green" : "yellow"} />
          {report.confirmed ? (
            <>
              <Card title="Confirmed Bank" value={peso(result.confirmedBank)} tone="green" />
              <Card title="Pending Verification" value={peso(result.pendingBank)} tone="yellow" />
              <Card title="Pending Cash On Hand" value={peso(result.pendingCashOnHand)} tone="yellow" />
              <Card title="Actual Cash Counted" value={result.actualCashCountEntered ? peso(result.actualCashCounted) : "Not counted yet"} tone={result.actualCashCountEntered ? "green" : "yellow"} />
              <Card title="Actual Cash Difference" value={result.actualCashCountEntered ? peso(result.actualCashDifference) : "Not counted yet"} note="Cashier count vs expected cash on hand" tone={result.actualCashDifference < 0 ? "negative" : result.actualCashDifference > 0 ? "green" : "dark"} />
              <Card title="Cash Variance" value={peso(result.cashVariance)} tone="negative" />
              <Card title="Underground Tank Difference" value={liter(result.tankVariance)} tone={varianceClass(result.tankVariance, true)} />
              <Card title="Review Status" value={<ReviewBadge flags={reviewFlags} />} note={reviewFlags.join(", ")} tone={reviewFlags.length ? "yellow" : "green"} />
            </>
          ) : (
            <Card title="Report Numbers" value={peso(0)} note="Draft report. Counts after cashier submits." tone="yellow" />
          )}
          <Card title="Starting Baseline" value={report.baselineConfirmed ? "Recorded" : "Not Set"} note={report.baselineConfirmedAt || "Cashier first opening setup"} tone={report.baselineConfirmed ? "green" : "yellow"} />
        </div>
        <div className="admin-overview-export form-space">
          <div className="admin-overview-export-head">
            <div>
              <h3>Save Reports to Excel</h3>
              <p>Download completed station reports directly to this computer.</p>
            </div>
          </div>
          <div className="admin-overview-export-controls">
            <Field label="From"><TextInput type="date" value={reportExportStartDate} onChange={setReportExportStartDate} /></Field>
            <Field label="To"><TextInput type="date" value={reportExportEndDate} onChange={setReportExportEndDate} /></Field>
            <button type="button" className="primary" onClick={() => downloadReportExport(false)}>Download Date Range</button>
            <button type="button" className="secondary" onClick={() => downloadReportExport(true)}>Download All Reports</button>
          </div>
          {reportExportMessage && <p className="admin-overview-export-message" role="status">{reportExportMessage}</p>}
        </div>
        <div className="form-space">
          <h3>Real Cash Shortage / Overage</h3>
          <p className="neutral">Physical cash counted minus expected cash. Bank deposits, pending verification, and pending cash on hand are not included.</p>
          <div className="grid three">
            <Card title="Alerts Shown" value={`${visibleCashAlertRows.length}`} note={`Small shortages below ${peso(CASH_SHORTAGE_ALERT_THRESHOLD)} are hidden`} tone="dark" />
            <Card title="Shortages" value={peso(totalCashShortage)} note={`Only -${peso(CASH_SHORTAGE_ALERT_THRESHOLD)} or lower · ${cashShortageRows.length} report${cashShortageRows.length === 1 ? "" : "s"}`} tone={cashShortageRows.length ? "negative" : "green"} />
            <Card title="Overages" value={peso(totalCashOverage)} note={`${cashOverageRows.length} report${cashOverageRows.length === 1 ? "" : "s"}`} tone={cashOverageRows.length ? "yellow" : "green"} />
          </div>
          <Table headers={["Date", "Station", "Shift", "Cashier", "Expected Cash", "Physical Cash Counted", "Difference", "Result"]} minWidth="1180px">
            {visibleCashAlertRows.length === 0 ? (
              <tr><td colSpan="8">No major cash shortages or overages.</td></tr>
            ) : visibleCashAlertRows.map((row) => (
              <tr key={row.key}>
                <td>{row.date}</td>
                <td><b>{row.branch}</b></td>
                <td>{shortShiftLabel(row.shiftId)}</td>
                <td>{row.cashierName}</td>
                <td>{peso(row.expectedCash)}</td>
                <td>{peso(row.physicalCashCounted)}</td>
                <td><b>{peso(row.difference)}</b></td>
                <td><Status tone={row.status === "Shortage" ? "red" : row.status === "Overage" ? "yellow" : "green"}>{row.status}</Status></td>
              </tr>
            ))}
          </Table>
        </div>
      </Section>
      )}

      {activeDesktopCategory === "reports" && (
      <Section id="admin-section-reports" title="All Submitted Reports" className="admin-reports-section">
        <div className="grid four admin-report-filters">
          <Field label="Station"><SelectInput value={reportBrowserBranch} onChange={setReportBrowserBranch} options={HEALTH_BRANCH_OPTIONS} /></Field>
          <Field label="From"><TextInput type="date" value={reportBrowserStartDate} onChange={setReportBrowserStartDate} /></Field>
          <Field label="To"><TextInput type="date" value={reportBrowserEndDate} onChange={setReportBrowserEndDate} /></Field>
          <Field label="Shift"><SelectInput value={reportBrowserShift} onChange={setReportBrowserShift} options={["All Shifts", ...SHIFT_OPTIONS.map((shift) => ({ value: shift.id, label: shift.label }))]} /></Field>
          <Field label="Report Status"><SelectInput value={reportBrowserStatus} onChange={setReportBrowserStatus} options={["All Reports", "Normal", "Check Required", "Opening Setup"]} /></Field>
          <Card title="Reports Found" value={`${adminReportCards.length}`} note="Completed reports matching these filters" tone="dark" />
        </div>

        <div className="admin-report-carousel-head">
          <div>
            <h3>Report Cards</h3>
            <p>Swipe, use a trackpad, or use the arrow buttons to browse.</p>
          </div>
          <div className="admin-report-carousel-controls">
            <button type="button" onClick={() => scrollAdminReportCards(-1)} aria-label="Previous reports" title="Previous reports">&larr;</button>
            <button type="button" onClick={() => scrollAdminReportCards(1)} aria-label="Next reports" title="Next reports">&rarr;</button>
          </div>
        </div>

        {adminReportCards.length ? (
          <div className="admin-report-carousel" ref={reportCarouselRef} role="region" aria-label="Submitted report cards">
            {adminReportCards.map((item) => {
              const itemKey = reportKey(item.branch, item.date, item.shiftId);
              const itemResult = compute(item);
              const itemFlags = reportReviewFlags(item, itemResult);
              const isOpening = openingSetupCompleted(item);
              const statusLabel = isOpening ? "Opening Setup" : itemFlags.length ? "Check Required" : "Normal";
              return (
                <button
                  key={itemKey}
                  type="button"
                  className={`admin-report-card ${selectedAdminReportKey === itemKey ? "active" : ""}`.trim()}
                  onClick={() => setSelectedAdminReportKey(itemKey)}
                  aria-pressed={selectedAdminReportKey === itemKey}
                >
                  <span className={`admin-report-status ${itemFlags.length ? "warning" : "normal"}`}>{statusLabel}</span>
                  <strong>{item.branch}</strong>
                  <span className="admin-report-date">{item.date} · {shiftById(item.shiftId).label}</span>
                  <span className="admin-report-cashier">{item.cashierName || (isOpening ? "Starting readings" : "Cashier not recorded")}</span>
                  <div className="admin-report-card-metrics">
                    <span><small>Liters</small><b>{liter(itemResult.totalLiters)}</b></span>
                    <span><small>Gross Sales</small><b>{peso(itemResult.grossSales)}</b></span>
                    <span><small>Expected</small><b>{peso(itemResult.expectedCash)}</b></span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="admin-report-empty">
            <strong>No completed reports found</strong>
            <span>Adjust the station, date, shift, or status filters.</span>
          </div>
        )}

        {selectedAdminReport && selectedAdminReportResult && (
          <div className="admin-report-detail">
            <div className="admin-report-detail-head">
              <div>
                <span>Selected Report</span>
                <h3>{selectedAdminReport.branch} · {selectedAdminReport.date}</h3>
                <p>{shiftById(selectedAdminReport.shiftId).label} · {selectedAdminReport.cashierName || "Opening setup"}</p>
              </div>
              <div className="admin-report-detail-actions">
                <ReviewBadge flags={selectedAdminReportFlags} />
                <button type="button" className="secondary" onClick={openSelectedAdminReport}>Open in Admin View</button>
              </div>
            </div>

            <div className="grid four admin-report-summary-grid">
              <Card title="Total Liters" value={liter(selectedAdminReportResult.totalLiters)} tone="dark" />
              <Card title="Gross Sales" value={peso(selectedAdminReportResult.grossSales)} />
              <Card title="Deductions" value={peso(selectedAdminReportResult.deductionTotal)} />
              <Card title="Expected Cash" value={peso(selectedAdminReportResult.expectedCash)} />
              <Card title="Actual Cash Counted" value={selectedAdminReportResult.actualCashCountEntered ? peso(selectedAdminReportResult.actualCashCounted) : "Not counted"} tone={selectedAdminReportResult.actualCashCountEntered ? "green" : "yellow"} />
              <Card title="Bank Deposit" value={peso(selectedAdminReportResult.bankDeposit)} />
              <Card title="Pending Cash" value={peso(selectedAdminReportResult.pendingCashOnHand)} tone="yellow" />
              <Card title="Cash Variance" value={peso(selectedAdminReportResult.cashVariance)} tone={Math.abs(selectedAdminReportResult.cashVariance) > REVIEW_CASH_VARIANCE_THRESHOLD ? "negative" : ""} />
              <Card title="Cash Vouchers" value={peso(selectedAdminReportResult.purchaseTotal)} note={`${selectedAdminReportCashVouchers.length} voucher${selectedAdminReportCashVouchers.length === 1 ? "" : "s"}`} />
            </div>

            {selectedAdminReviewMessage && (
              <section className="admin-review-message" aria-label="Messenger follow-up message">
                <div className="admin-review-message-head">
                  <div>
                    <span>Messenger Follow-up</span>
                    <h4>Message for {selectedAdminReport.cashierName || selectedAdminReport.branch}</h4>
                  </div>
                  <button type="button" className="secondary" onClick={copySelectedReviewMessage}>
                    {copiedReviewMessageKey === selectedAdminReportKey ? "Copied" : "Copy Message"}
                  </button>
                </div>
                <textarea readOnly value={selectedAdminReviewMessage} aria-label="Review message" />
              </section>
            )}

            <div className="grid three admin-report-products">
              {FUEL_TYPES.map((product) => (
                <div className="admin-report-product" key={product}>
                  <span>{product}</span>
                  <strong>{liter(selectedAdminReportResult.fuelLiters[product])}</strong>
                  <small>{peso(selectedAdminReportResult.fuelSalesByProduct[product])}</small>
                </div>
              ))}
            </div>

            <details className="details-panel admin-report-details-panel" open>
              <summary>Pump Register</summary>
              <Table headers={["Pump", "Nozzle", "Product", "Previous Closing", "Current Closing", "Liters Sold"]} minWidth="820px">
                {(selectedAdminReport.pumpRows || []).map((row) => (
                  <tr key={row.id}>
                    <td><b>{row.pump}</b></td>
                    <td>{row.nozzle}</td>
                    <td>{row.product}</td>
                    <td>{n(row.opening).toFixed(2)}</td>
                    <td>{n(row.closing).toFixed(2)}</td>
                    <td><b>{liter(pumpLitersSold(row))}</b></td>
                  </tr>
                ))}
              </Table>
            </details>

            {(selectedAdminReport.midShiftPriceChanges || []).length > 0 && (
              <details className="details-panel admin-report-details-panel" open>
                <summary>Mid-Shift Price Change ({selectedAdminReport.midShiftPriceChanges.length})</summary>
                <p className="neutral">All saved price-change readings for every affected pump and product.</p>
                <Table headers={["Pump", "Nozzle", "Product", "Effective Time", "Price-Change Reading", "New Price", "Status"]} minWidth="880px">
                  {selectedAdminMidShiftReadings.map((row) => (
                    <tr key={row.id}>
                      <td><b>{row.pump}</b></td>
                      <td>{row.nozzle}</td>
                      <td>{row.product}</td>
                      <td>{row.effectiveTime}</td>
                      <td>{row.reading == null ? <span className="warning-text">Missing</span> : row.reading.toFixed(2)}</td>
                      <td>{peso(row.newPrice)}</td>
                      <td>{row.confirmed ? "Confirmed" : "Draft"}</td>
                    </tr>
                  ))}
                </Table>
                <p className="neutral">Sales are pump liters for each time period multiplied by the price active during that period.</p>
                {selectedAdminMidShiftSales.length ? (
                  <Table headers={["Pump", "Nozzle", "Product", "Sales Period", "Reading From", "Reading To", "Liters Sold", "Price / L", "Sales"]} minWidth="1180px">
                    {selectedAdminMidShiftSales.map((row) => (
                      <tr key={row.id}>
                        <td><b>{row.pump}</b></td>
                        <td>{row.nozzle}</td>
                        <td>{row.product}</td>
                        <td><b>{row.fromLabel} to {row.toLabel}</b></td>
                        <td>{row.readingFrom.toFixed(2)}</td>
                        <td>{row.readingTo.toFixed(2)}</td>
                        <td>{liter(row.liters)}</td>
                        <td>{peso(row.price)}</td>
                        <td><b>{peso(row.sales)}</b></td>
                      </tr>
                    ))}
                    <tr className="total-row">
                      <td colSpan="6">Mid-Shift Period Total</td>
                      <td>{liter(selectedAdminMidShiftSales.reduce((sum, row) => sum + row.liters, 0))}</td>
                      <td></td>
                      <td>{peso(selectedAdminMidShiftSales.reduce((sum, row) => sum + row.sales, 0))}</td>
                    </tr>
                  </Table>
                ) : <div className="admin-report-empty compact">Price change details are incomplete for this report.</div>}
              </details>
            )}

            <details className="details-panel admin-report-details-panel">
              <summary>Underground Tanks</summary>
              <Table headers={["Product", "Opening", "Delivery", "Pullout", "Calibration", "Actual Dip", "Difference"]} minWidth="820px">
                {selectedAdminReportResult.tankRows.map((row) => (
                  <tr key={row.id}>
                    <td><b>{row.product}</b></td>
                    <td>{liter(row.opening)}</td>
                    <td>{liter(row.delivery)}</td>
                    <td>{liter(row.pullOut)}</td>
                    <td>{liter(row.calibration)}</td>
                    <td>{liter(row.actualDip)}</td>
                    <td className={varianceClass(row.variance, true)}><b>{liter(row.variance)}</b></td>
                  </tr>
                ))}
              </Table>
            </details>

            <details className="details-panel admin-report-details-panel">
              <summary>Deductions and PO Accounts</summary>
              {selectedAdminReportDeductions.length ? (
                <Table headers={["Type", "Amount"]} minWidth="520px">
                  {selectedAdminReportDeductions.map((row) => (
                    <tr key={row.id}>
                      <td><b>{row.label}</b></td>
                      <td>{peso(row.amount)}</td>
                    </tr>
                  ))}
                </Table>
              ) : <div className="admin-report-empty compact">No deductions or PO accounts recorded.</div>}
            </details>

            <details className="details-panel admin-report-details-panel" open>
              <summary>Cash Voucher Details ({selectedAdminReportCashVouchers.length})</summary>
              {selectedAdminReportCashVouchers.length ? (
                <Table headers={["Category", "Particular", "Amount"]} minWidth="620px">
                  {selectedAdminReportCashVouchers.map((row) => (
                    <tr key={row.id}>
                      <td><b>{row.category}</b></td>
                      <td>{row.particular}</td>
                      <td>{peso(row.amount)}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td colSpan="2">Total Cash Vouchers</td>
                    <td>{peso(selectedAdminReportResult.purchaseTotal)}</td>
                  </tr>
                </Table>
              ) : <div className="admin-report-empty compact">No cash vouchers recorded for this report.</div>}
            </details>

            <details className="details-panel admin-report-details-panel">
              <summary>Bank Deposits</summary>
              {activeDeposits(selectedAdminReport).length ? (
                <Table headers={["Deposit Date", "Coverage", "Bank", "Reference", "Amount", "Status"]} minWidth="760px">
                  {activeDeposits(selectedAdminReport).map((deposit) => (
                    <tr key={deposit.id}>
                      <td>{deposit.depositDate || selectedAdminReport.date}</td>
                      <td>{deposit.coverageLabel || depositCoverageLabel(deposit.coverage)}</td>
                      <td>{deposit.bank || "Not recorded"}</td>
                      <td>{deposit.reference || "Not recorded"}</td>
                      <td><b>{peso(deposit.amount)}</b></td>
                      <td>{deposit.verified ? "Verified" : "Pending"}</td>
                    </tr>
                  ))}
                </Table>
              ) : <div className="admin-report-empty compact">No bank deposit attached to this report.</div>}
            </details>
          </div>
        )}
      </Section>
      )}

      {activeDesktopCategory === "performance" && (
      <Section id="admin-section-performance" title="Station Performance" className="performance-dashboard-section">
        <div className="performance-dashboard-head">
          <div>
            <span>ADMIN</span>
            <p>Submitted station performance</p>
          </div>
          <div className="performance-dashboard-filters">
            <Field label="Station"><SelectInput value={performanceBranch} onChange={setPerformanceBranch} options={["All Stations", ...BRANCHES]} /></Field>
            <Field label="Report Date"><TextInput type="date" value={performanceDate} onChange={setPerformanceDate} /></Field>
            {performancePeriod === "Shift" && <Field label="Shift"><SelectInput value={performanceShiftId} onChange={setPerformanceShiftId} options={SHIFT_OPTIONS.map((shift) => ({ value: shift.id, label: shift.label }))} /></Field>}
          </div>
        </div>

        <div className="performance-period-tabs" role="tablist" aria-label="Performance period">
          {OWNER_PERIOD_OPTIONS.map((period) => (
            <button
              type="button"
              role="tab"
              aria-selected={performancePeriod === period}
              className={performancePeriod === period ? "active" : ""}
              key={period}
              onClick={() => setPerformancePeriod(period)}
            >
              {period === "All-time" ? "All Time" : period}
            </button>
          ))}
        </div>

        <PerformanceVolumeChart
          rows={performanceMetricTrends.volume}
          average={performanceAverageDailyVolume}
          rangeLabel={`${performanceRange.start} to ${performanceRange.end}`}
        />

        <div className="performance-kpi-grid">
          <PerformanceMetric index={1} title="Average Daily Volume" value={liter(performanceAverageDailyVolume)} rows={performanceMetricTrends.volume} />
          <PerformanceMetric index={2} title="Tank Inventory Value" value={peso(performanceTankValue)} note="Latest submitted tank readings" rows={[]} />
          <PerformanceMetric index={3} title="Total FuelTech Pay" value={peso(performanceSummary.fuelTechPayTotal)} rows={performanceMetricTrends.fuelTechPay} />
          <PerformanceMetric index={4} title="Total PO" value={peso(performanceSummary.poTotal)} rows={performanceMetricTrends.po} />
          <PerformanceMetric index={5} title="Fuel Redemption" value={peso(performanceFuelRedemption)} rows={performanceMetricTrends.fuelRedemption} />
          <PerformanceMetric index={6} title="Cash Redemption" value={peso(performanceCashRedemption)} rows={performanceMetricTrends.cashRedemption} />
          <PerformanceMetric index={7} title="Coke Used" value={`${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(performanceSummary.cokeSold)} pcs`} rows={performanceMetricTrends.coke} />
          <PerformanceMetric index={8} title="Points Issued" value={new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(performanceSummary.pointsIssued)} rows={performanceMetricTrends.points} />
          <PerformanceMetric index={9} title="Total Cash Vouchers" value={peso(performanceSummary.purchaseTotal)} rows={performanceMetricTrends.cashVouchers} />
        </div>

        <div className="performance-financial-strip">
          <Card title="Gross Sales" value={peso(performanceSummary.grossSales)} />
          <Card title="Expected Cash" value={peso(performanceSummary.expectedCash)} />
          <Card title="Actual Cash" value={performanceSummary.actualCashCountedReports ? peso(performanceSummary.actualCashCounted) : "Not counted"} tone={performanceSummary.actualCashCountedReports ? "green" : "yellow"} />
          <Card title="Deductions" value={peso(performanceSummary.deductions)} />
          <Card title="Pending Deposits" value={peso(performanceSummary.pendingBank)} tone={performanceSummary.pendingBank ? "yellow" : "green"} />
          <Card title="Fuel Margin" value={peso(performanceMargin)} note="Selling price minus confirmed delivery cost" tone="green" />
        </div>

        <Table headers={["Station", "Reports", "Liters Sold", "Gross Sales", "Expected Cash", "Actual Cash", "Deductions", "Pending Deposits", "Margin"]} minWidth="1280px">
          {performanceRows.length === 0 ? <tr><td colSpan="9">No submitted reports in this period.</td></tr> : performanceRows.map((row) => (
            <tr key={row.station}>
              <td><b>{row.station}</b></td>
              <td>{row.reports.length}</td>
              <td>{liter(row.summary.totalLiters)}</td>
              <td>{peso(row.summary.grossSales)}</td>
              <td>{peso(row.summary.expectedCash)}</td>
              <td>{row.summary.actualCashCountedReports ? peso(row.summary.actualCashCounted) : "Not counted"}</td>
              <td>{peso(row.summary.deductions)}</td>
              <td>{peso(row.summary.pendingBank)}</td>
              <td><b>{peso(row.margin)}</b></td>
            </tr>
          ))}
        </Table>
      </Section>
      )}

      {activeDesktopCategory === "fuel-costs" && (
      <Section id="admin-section-fuel-costs" title="Fuel Delivery Costs">
        <div className="grid four">
          <Card title="Delivery Rows" value={adminFuelDeliveryRows.length} tone="dark" />
          <Card title="Selected Delivery" value={selectedFuelDelivery ? `${selectedFuelDelivery.branch} | ${selectedFuelDelivery.date}` : "None"} />
          <Card title="Shift Delivered" value={selectedFuelDelivery ? shiftById(selectedFuelDelivery.shiftId).label : "No delivery"} />
          <Card title="Amount of Liters" value={selectedFuelDelivery ? liter(selectedFuelDelivery.totalLiters) : liter(0)} tone={selectedFuelDelivery ? "green" : "yellow"} />
          <Card title="Fuel Cost Confirmed" value={selectedFuelDeliveryConfirmed ? "Sent" : "Not sent yet"} note={selectedFuelDeliveryConfirmedNote} tone={selectedFuelDeliveryConfirmed ? "green" : "yellow"} />
          <Card title="Pricing Basis" value="Daily" note="Carries forward until changed" />
          <Card title="Owner Margin" value="Uses real costs" tone="green" />
        </div>
        <Table headers={["Date Delivered", "Station", "Shift Delivered", "Premium Liters", "Regular Liters", "Diesel Liters", "Amount of Liters", "Status", "Action"]} minWidth="1120px">
          {adminFuelDeliveryRows.length === 0 ? (
            <tr><td colSpan="9">No cashier delivery entered yet.</td></tr>
          ) : adminFuelDeliveryRows.map((row) => {
            const needsCost = !row.confirmed || row.missingCosts.length > 0;
            return (
              <tr key={row.key}>
                <td>{row.date}</td>
                <td><b>{row.branch}</b></td>
                <td>{shiftById(row.shiftId).label}</td>
                <td>{liter(row.deliveryLiters.Premium)}</td>
                <td>{liter(row.deliveryLiters.Regular)}</td>
                <td>{liter(row.deliveryLiters.Diesel)}</td>
                <td><b>{liter(row.totalLiters)}</b></td>
                <td>
                  <Status tone={needsCost ? "yellow" : "green"}>
                    {row.missingCosts.length ? `Missing ${row.missingCosts.join(", ")}` : row.confirmed ? "Cost Saved" : "Needs Confirm"}
                  </Status>
                </td>
                <td>
                  <button type="button" className="small-success" onClick={() => setSelectedFuelDeliveryKey(row.key)}>
                    {selectedFuelDelivery?.key === row.key ? "Selected" : "Enter Cost"}
                  </button>
                </td>
              </tr>
            );
          })}
        </Table>
        {selectedFuelDelivery ? (
          <>
            <div className="grid three form-space">
              {FUEL_TYPES.map((product) => {
                const hasDelivery = n(adminDeliveryLiters[product]) > 0;
                return (
                  <div className="price-box" key={product}>
                    <Card title={`${product} Delivery Entered`} value={liter(adminDeliveryLiters[product])} tone={hasDelivery ? "green" : "yellow"} />
                    <Field label={`${product} Delivery Cost`}>
                      {hasDelivery ? (
                        <NumberInput value={fuelCostDraft.costs?.[fuelCostKey(product)] ?? adminCostPrices[fuelCostKey(product)]} onChange={(value) => patchFuelCostDraft(product, value)} />
                      ) : (
                        <b className="read-only-value">{peso(adminCostPrices[fuelCostKey(product)])}</b>
                      )}
                      <small>{hasDelivery ? "Edit the cost, then press confirm to send." : "No delivery for this product."}</small>
                    </Field>
                  </div>
                );
              })}
            </div>
            <button type="button" className="confirm-button" onClick={confirmFuelDeliveryCosts} disabled={!hasAnyAdminDelivery || fuelCostSaving}>
              {fuelCostSaving ? "Sending Fuel Costs..." : "Confirm Fuel Delivery Costs"}
            </button>
          </>
        ) : (
          <div className="warning-box">No cashier delivery entered yet.</div>
        )}
      </Section>
      )}

      {activeDesktopCategory === "price-history" && (
      <Section id="admin-section-price-history" title="Price Change History">
        <div className="grid four">
          <Card title="Price Changes" value={`${priceChangeRows.length}`} tone="dark" />
          <Card title="Daily Prices" value={`${priceChangeRows.filter((row) => row.source === "Manager price").length}`} />
          <Card title="Mid-Shift Changes" value={`${priceChangeRows.filter((row) => row.source === "Mid-shift change").length}`} />
          <Card title="Admin Use" value="Audit prices" tone="green" />
        </div>
        <Table headers={["Date", "Station", "Shift", "Product", "Price", "Source"]} minWidth="1120px">
          {priceChangeRows.length === 0 ? (
            <tr><td colSpan="6">No price changes recorded yet.</td></tr>
          ) : priceChangeRows.map((row) => (
            <tr key={row.key}>
              <td>{row.date}</td>
              <td><b>{row.branch}</b></td>
              <td>{row.shift}</td>
              <td>{row.product}</td>
              <td>{row.value}</td>
              <td><Status tone={row.source === "Mid-shift change" ? "yellow" : "green"}>{row.source}</Status></td>
            </tr>
          ))}
        </Table>
      </Section>
      )}

      {activeDesktopCategory === "health" && (
      <Section id="admin-section-health" title="System Health">
        <div className="grid four">
          <Card title="Nightly Backup" value={system.backupStatus} note={`${system.backupDate} · ${system.backupReports} reports`} tone={system.backupTone === "good" ? "green" : "yellow"} />
          <Card title="Daily Report Check" value={system.healthStatus} note={system.healthDate} tone={system.healthTone === "good" ? "green" : "yellow"} />
          <Card title="Missing Reports" value={`${system.missingReports}`} note="Last daily check" tone={system.missingReports ? "red" : "green"} />
          <Card title="Missing Deposits" value={`${system.missingDeposits}`} note={`${system.pendingDeposits} pending verification`} tone={system.missingDeposits ? "red" : system.pendingDeposits ? "yellow" : "green"} />
          <Card title="Checked Cash Variance" value={peso(system.cashVariance)} tone={n(system.cashVariance) < 0 ? "negative" : "dark"} />
          <button type="button" className="secondary" onClick={() => exportDailyBackup(selectedDate)}>Backup Selected Date</button>
          <button type="button" className="secondary" onClick={testLatestBackupRestore} disabled={restoreTest.loading}>{restoreTest.loading ? "Testing Restore..." : "Test Latest Backup Restore"}</button>
        </div>
        {restoreTest.result && <div className="success-box form-space"><b>Backup restore test passed.</b> {restoreTest.result.reportCount} reports and {restoreTest.result.priceCount} price records reconstructed from {restoreTest.result.backupDate}. Live data was not changed.</div>}
        {restoreTest.error && <div className="warning-box form-space">{restoreTest.error}</div>}
        {system.error && <div className="warning-box">{system.error}</div>}
        {system.setupNeeded && <div className="warning-box">Run the Supabase hardening SQL once so backup and daily health records can be saved.</div>}
        <div className="grid four form-space">
          <Field label="Station"><SelectInput value={healthBranch} onChange={setHealthBranch} options={HEALTH_BRANCH_OPTIONS} /></Field>
          <Field label="From Date"><TextInput type="date" value={healthStartDate} onChange={setHealthStartDate} /></Field>
          <Field label="To Date"><TextInput type="date" value={healthEndDate} onChange={setHealthEndDate} /></Field>
          <Card title="Report Scope" value={healthBranch === "All Stations" ? "All Stations" : healthBranch} note={`${healthStartDate} to ${healthEndDate}`} tone="dark" />
        </div>
        <div className="grid four">
          <Card title="Submitted" value={`${n(filteredHealthCounts.Submitted)}`} tone="green" />
          <Card title="Draft" value={`${n(filteredHealthCounts.Draft)}`} tone={n(filteredHealthCounts.Draft) ? "yellow" : "green"} />
          <Card title="Missing" value={`${n(filteredHealthCounts.Missing)}`} tone={n(filteredHealthCounts.Missing) ? "red" : "green"} />
          <Card title="Check Required" value={`${n(filteredHealthCounts["Check Required"])}`} tone={n(filteredHealthCounts["Check Required"]) ? "yellow" : "green"} />
        </div>
      </Section>
      )}

      {activeDesktopCategory === "corrections" && (
      <Section id="admin-section-corrections" title="Date Correction Requests">
        <Table headers={["Station", "Report Date", "Shift", "Reason", "Status", "Expires", "Action"]} minWidth="1080px">
          {correctionRequests.length === 0 ? (
            <tr><td colSpan="7">No active correction requests.</td></tr>
          ) : correctionRequests.map((requestReport) => {
            const request = correctionRequest(requestReport);
            const expired = request.status === "approved" && !isActiveCorrectionApproval(requestReport);
            return (
              <tr key={`${requestReport.branch}-${requestReport.date}-${requestReport.shiftId}-${request.id || "correction"}`}>
                <td><b>{requestReport.branch}</b></td>
                <td>{request.reportDate || requestReport.date}</td>
                <td>{shiftById(request.shiftId || requestReport.shiftId).label}</td>
                <td>{request.reason}</td>
                <td><Status tone={request.status === "approved" && !expired ? "green" : "yellow"}>{expired ? "Expired" : request.status}</Status></td>
                <td>{request.expiresAt ? new Date(request.expiresAt).toLocaleString("en-PH") : "Not approved yet"}</td>
                <td>
                  <div className="action-row">
                    <button type="button" className="small-success" disabled={request.status === "approved" && !expired} onClick={() => approveCorrectionRequest(requestReport)}>Approve</button>
                    <button type="button" className="small-danger" onClick={() => rejectCorrectionRequest(requestReport)}>Reject</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
        <div className="form-space">
          <h3>Missing Shift Activity</h3>
          <Table headers={["Time", "Role", "Name", "Station", "From", "Went To", "Missing Status"]} minWidth="1080px">
            {missingShiftActivities.length === 0 ? (
              <tr><td colSpan="7">No missing-shift jumps recorded yet.</td></tr>
            ) : missingShiftActivities.map(({ activity }) => (
              <tr key={activity.id}>
                <td>{activity.at ? new Date(activity.at).toLocaleString("en-PH") : ""}</td>
                <td>{activity.role}</td>
                <td><b>{activity.actor}</b></td>
                <td>{activity.branch}</td>
                <td>{activity.fromDate} {shortShiftLabel(activity.fromShiftId)}</td>
                <td>{activity.toDate} {shortShiftLabel(activity.toShiftId)}</td>
                <td><Status tone={activity.status === "Missing" ? "red" : "yellow"}>{activity.status}</Status></td>
              </tr>
            ))}
          </Table>
        </div>
      </Section>
      )}

      {activeDesktopCategory === "station-health" && (
      <Section id="admin-section-station-health" title="Station Health Summary">
        <div className="grid four">
          <Field label="Station"><SelectInput value={healthBranch} onChange={setHealthBranch} options={HEALTH_BRANCH_OPTIONS} /></Field>
          <Field label="Health From Date"><TextInput type="date" value={healthStartDate} onChange={setHealthStartDate} /></Field>
          <Field label="Health To Date"><TextInput type="date" value={healthEndDate} onChange={setHealthEndDate} /></Field>
          <Card title="Health Rows" value={`${filteredHealthRows.length}`} note={healthBranch === "All Stations" ? "All stations" : healthBranch} tone="dark" />
        </div>
        <div className="grid four">
          <Card title="Submitted" value={`${n(filteredHealthCounts.Submitted)}`} tone="green" />
          <Card title="Draft" value={`${n(filteredHealthCounts.Draft)}`} tone={n(filteredHealthCounts.Draft) ? "yellow" : "green"} />
          <Card title="Missing" value={`${n(filteredHealthCounts.Missing)}`} tone={n(filteredHealthCounts.Missing) ? "red" : "green"} />
          <Card title="Check Required" value={`${n(filteredHealthCounts["Check Required"])}`} tone={n(filteredHealthCounts["Check Required"]) ? "yellow" : "green"} />
        </div>
        <Table headers={["Date", "Station", ...SHIFT_OPTIONS.map((shift) => shift.label)]} minWidth="1040px">
          {filteredHealthRows.map((row) => (
            <tr key={`${row.date}-${row.branch}`}>
              <td>{row.date}</td>
              <td><b>{row.branch}</b></td>
              {row.shifts.map(({ shift, status }) => (
                <td key={shift.id}><Status tone={status.tone}>{status.label}</Status></td>
              ))}
            </tr>
          ))}
        </Table>
      </Section>
      )}

      {activeDesktopCategory === "deposit-health" && (
      <Section id="admin-section-deposit-health" title="Deposit Health Summary">
        <div className="grid four">
          <Field label="Station"><SelectInput value={healthBranch} onChange={setHealthBranch} options={HEALTH_BRANCH_OPTIONS} /></Field>
          <Field label="Health From Date"><TextInput type="date" value={healthStartDate} onChange={setHealthStartDate} /></Field>
          <Field label="Health To Date"><TextInput type="date" value={healthEndDate} onChange={setHealthEndDate} /></Field>
          <Card title="Deposit Rows" value={`${filteredDepositRows.length}`} note={healthBranch === "All Stations" ? "All stations" : healthBranch} tone="dark" />
        </div>
        <div className="grid four">
          <Card title="Deposit Saved" value={`${n(filteredDepositCounts["Deposit Saved"])}`} tone="green" />
          <Card title="Deposit Pending" value={`${n(filteredDepositCounts["Deposit Pending"])}`} tone={n(filteredDepositCounts["Deposit Pending"]) ? "yellow" : "green"} />
          <Card title="Deposit Missing" value={`${n(filteredDepositCounts["Deposit Missing"])}`} tone={n(filteredDepositCounts["Deposit Missing"]) ? "red" : "green"} />
          <Card title="No Report" value={`${n(filteredDepositCounts["No Report"])}`} tone={n(filteredDepositCounts["No Report"]) ? "red" : "green"} />
        </div>
        <Table headers={["Date", "Station", ...SHIFT_OPTIONS.map((shift) => shift.label)]} minWidth="1040px">
          {filteredDepositRows.map((row) => (
            <tr key={`deposit-${row.date}-${row.branch}`}>
              <td>{row.date}</td>
              <td><b>{row.branch}</b></td>
              {row.shifts.map(({ shift, status }) => (
                <td key={shift.id}><Status tone={status.tone}>{status.label}</Status></td>
              ))}
            </tr>
          ))}
        </Table>
      </Section>
      )}

      {activeDesktopCategory === "bank" && (
      <>
      <Section id="admin-section-bank" title="Consolidated Bank Verification">
        <div className="grid four">
          <Card title="Deposits Listed" value={`${consolidatedDeposits.length}`} />
          <Card title="Pending Verification" value={`${consolidatedDeposits.filter(({ deposit }) => !deposit.verified && !isRemovalRequested(deposit)).length}`} tone="yellow" />
          <Card title="Verified" value={`${consolidatedDeposits.filter(({ deposit }) => deposit.verified).length}`} tone="green" />
        </div>
        <Table headers={["Sales Date", "Station", "Counted Shift", "Deposit Date", "Bank", "Reference", "Amount", "Status", "Action"]} minWidth="1180px">
          {consolidatedDeposits.length === 0 ? (
            <tr>
              <td colSpan="9">No bank deposits in the selected summary date range.</td>
            </tr>
          ) : consolidatedDeposits.map(({ report: depositReport, deposit }) => (
              <tr key={`${depositReport.branch}-${depositReport.date}-${depositReport.shiftId}-${deposit.id}`}>
                <td>{deposit.salesDateCovered || depositReport.date}</td>
                <td><b>{depositReport.branch}</b></td>
                <td>{shortShiftLabel(depositReport.shiftId)}</td>
                <td>{deposit.depositDate || depositReport.date}</td>
                <td>{deposit.bank}</td>
                <td>{deposit.reference}</td>
                <td><b>{peso(deposit.amount)}</b></td>
                <td><Status tone={isRemovalRequested(deposit) ? "yellow" : deposit.verified ? "green" : "yellow"}>{isRemovalRequested(deposit) ? depositRequestLabel(deposit) : deposit.verified ? "Verified" : "Pending"}</Status></td>
                <td>
                  {isRemovalRequested(deposit) ? (
                    <div className="action-row">
                      <button type="button" className="small-danger" onClick={() => approveDepositRemoval(deposit.id, depositReport)}>{depositRequestActionLabel(deposit)}</button>
                      <button type="button" className="small-success" onClick={() => rejectDepositRemoval(deposit.id, depositReport)}>Reject Removal</button>
                    </div>
                  ) : (
                    <button type="button" className="small-success" onClick={() => verifyDeposit(deposit.id, depositReport)}>{deposit.verified ? "Undo" : "Verify"}</button>
                  )}
                </td>
              </tr>
          ))}
        </Table>
      </Section>

      <Section title="Bank Verification">
        <Table headers={["Bank", depositReferenceLabel, "Amount", "Status", "Action"]} minWidth="820px">
          {visibleDeposits.length === 0 ? (
            <tr><td colSpan="5">No bank deposits to verify for this submitted report.</td></tr>
          ) : visibleDeposits.map((deposit) => (
            <tr key={deposit.id}>
              <td>{deposit.bank}</td>
              <td>{deposit.reference}</td>
              <td><b>{peso(deposit.amount)}</b></td>
              <td><Status tone={isRemovalRequested(deposit) ? "yellow" : deposit.verified ? "green" : "yellow"}>{isRemovalRequested(deposit) ? depositRequestLabel(deposit) : deposit.verified ? "Verified" : "Pending"}</Status></td>
              <td>
                {isRemovalRequested(deposit) ? (
                  <div className="action-row">
                    <button type="button" className="small-danger" onClick={() => approveDepositRemoval(deposit.id)}>{depositRequestActionLabel(deposit)}</button>
                    <button type="button" className="small-success" onClick={() => rejectDepositRemoval(deposit.id)}>Reject Removal</button>
                  </div>
                ) : (
                  <button type="button" className="small-success" onClick={() => verifyDeposit(deposit.id)}>{deposit.verified ? "Undo" : "Verify"}</button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Section>
      </>
      )}

      {activeDesktopCategory === "summary" && (
      <Section id="admin-section-summary" title="Daily Station Summary">
        <div className="grid four">
          <Field label="Station Summary From"><TextInput type="date" value={stationSummaryStartDate} onChange={setStationSummaryStartDate} /></Field>
          <Field label="Station Summary To"><TextInput type="date" value={stationSummaryEndDate} onChange={setStationSummaryEndDate} /></Field>
          <Field label="Station Summary View"><SelectInput value={stationSummaryMode} onChange={setStationSummaryMode} options={["Daily", "Shift"]} /></Field>
          <Field label="Station Summary Shift"><SelectInput value={stationSummaryShiftId} onChange={setStationSummaryShiftId} options={SHIFT_OPTIONS.map((shift) => ({ value: shift.id, label: shift.label }))} /></Field>
        </div>

        <div className="grid two summary-scope-grid">
          <Card title="Station" value={branch} tone="dark" />
          <Card title="Reports Included" value={`${stationSummaryReports.length}`} note={stationSummaryMode === "Shift" ? `${shiftById(stationSummaryShiftId).label} only` : "All shifts in date range"} />
        </div>

        <div className="summary-metric-group">
          <h3>Sales and Volume</h3>
          <div className="summary-metric-grid">
          <Card title="Fuel Sales" value={peso(stationSummaryResult.fuelSales)} />
          <Card title="Oil Sales" value={peso(stationSummaryResult.oilSales)} />
          <Card title="Gross Sales" value={peso(stationSummaryResult.grossSales)} tone="dark" />
          <Card title="Total Liters" value={liter(stationSummaryResult.totalLiters)} />
          <Card title="Premium Liters" value={liter(stationSummaryResult.fuelLiters.Premium)} />
          <Card title="Regular Liters" value={liter(stationSummaryResult.fuelLiters.Regular)} />
          <Card title="Diesel Liters" value={liter(stationSummaryResult.fuelLiters.Diesel)} />
          </div>
        </div>

        <div className="summary-metric-group">
          <h3>Cash and Banking</h3>
          <div className="summary-metric-grid">
          <Card title="Expected Cash" value={peso(stationSummaryResult.expectedCash)} />
          <Card title="Actual Cash Counted" value={peso(stationSummaryResult.actualCashCounted)} note={`${stationSummaryResult.actualCashCountedReports} counted report${stationSummaryResult.actualCashCountedReports === 1 ? "" : "s"}`} tone={stationSummaryResult.actualCashCountedReports ? "green" : "yellow"} />
          <Card title="Cash Variance" value={peso(stationSummaryResult.cashVariance)} note="Actual cash counted minus expected cash for the same counted reports" tone={stationSummaryResult.cashVariance < 0 ? "negative" : stationSummaryResult.cashVariance > 0 ? "green" : "dark"} />
          <Card title="Cash On Hand Difference" value={peso(stationSummaryResult.actualCashDifference)} note="Physical cash vs expected cash remaining after deposits" tone={stationSummaryResult.actualCashDifference < 0 ? "negative" : stationSummaryResult.actualCashDifference > 0 ? "green" : "dark"} />
          <Card title="Bank Deposit" value={peso(stationSummaryResult.bankDeposit)} />
          <Card title="Confirmed Bank" value={peso(stationSummaryResult.confirmedBank)} tone="green" />
          <Card title="Pending Verification" value={peso(stationSummaryResult.pendingBank)} tone="yellow" />
          <Card title="Pending Cash On Hand" value={peso(stationSummaryResult.pendingCashOnHand)} tone="yellow" />
          </div>
        </div>

        <div className="summary-metric-group">
          <h3>Deductions and Adjustments</h3>
          <div className="summary-metric-grid">
          <Card title="Deductions" value={peso(stationSummaryResult.deductions)} />
          <Card title="Points Issued" value={peso(stationSummaryResult.pointsIssued)} />
          <Card title="Points Withdrawn" value={peso(stationSummaryResult.pointsWithdrawn)} />
          <Card title="Total PO" value={peso(stationSummaryResult.poTotal)} />
          <Card title="Total Cash Vouchers" value={peso(stationSummaryResult.purchaseTotal)} />
          </div>
        </div>

        <div className="summary-metric-group">
          <h3>Inventory Checks</h3>
          <div className="summary-metric-grid">
          <Card title="Pump Variance" value={liter(stationSummaryResult.pumpVariance)} tone={varianceClass(stationSummaryResult.pumpVariance, true)} />
          <Card title="Underground Tank Difference" value={liter(stationSummaryResult.tankVariance)} tone={varianceClass(stationSummaryResult.tankVariance, true)} />
          </div>
        </div>
        <CashVoucherBreakdown summary={stationSummaryResult} />
      </Section>
      )}

      {activeDesktopCategory === "consolidated" && (
      <Section id="admin-section-consolidated" title="Consolidated Summary - All Stations">
        <div className="grid three summary-toolbar">
          <Field label="Summary Start Date"><TextInput type="date" value={summaryStartDate} onChange={setSummaryStartDate} /></Field>
          <Field label="Summary End Date"><TextInput type="date" value={summaryEndDate} onChange={setSummaryEndDate} /></Field>
          <button type="button" className="secondary" onClick={() => exportDetailedReportsToExcel(adminSummaryReports, adminSummary, summaryStartDate, summaryEndDate)}>Export Detailed Excel</button>
        </div>

        <div className="grid three summary-scope-grid">
          <Card title="Consolidated Scope" value="All Stations" note="Mabolo, Arpili, Liloan, Pondol, Barili, and Moalboal" tone="dark" />
          <Card title="Reports Included" value={`${adminSummaryReports.length}`} note="Submitted reports only" />
          <Card title="Check Required" value={`${adminSummary.needsReviewCount} report${adminSummary.needsReviewCount === 1 ? "" : "s"}`} note="High pump liters or cash variance" tone={adminSummary.needsReviewCount ? "yellow" : "green"} />
        </div>

        <div className="summary-metric-group">
          <h3>Sales and Volume</h3>
          <div className="summary-metric-grid">
          <Card title="Fuel Sales" value={peso(adminSummary.fuelSales)} />
          <Card title="Oil Sales" value={peso(adminSummary.oilSales)} />
          <Card title="Gross Sales" value={peso(adminSummary.grossSales)} tone="dark" />
          <Card title="Total Liters" value={liter(adminSummary.totalLiters)} />
          <Card title="Premium Liters" value={liter(adminSummary.fuelLiters.Premium)} />
          <Card title="Regular Liters" value={liter(adminSummary.fuelLiters.Regular)} />
          <Card title="Diesel Liters" value={liter(adminSummary.fuelLiters.Diesel)} />
          </div>
        </div>

        <div className="summary-metric-group">
          <h3>Cash and Banking</h3>
          <div className="summary-metric-grid">
          <Card title="Expected Cash" value={peso(adminSummary.expectedCash)} />
          <Card title="Actual Cash Counted" value={peso(adminSummary.actualCashCounted)} note={`${adminSummary.actualCashCountedReports} counted report${adminSummary.actualCashCountedReports === 1 ? "" : "s"}`} tone={adminSummary.actualCashCountedReports ? "green" : "yellow"} />
          <Card title="Cash Variance" value={peso(adminSummary.cashVariance)} note="Actual cash counted minus expected cash for the same counted reports" tone={adminSummary.cashVariance < 0 ? "negative" : adminSummary.cashVariance > 0 ? "green" : "dark"} />
          <Card title="Cash On Hand Difference" value={peso(adminSummary.actualCashDifference)} note="Physical cash vs expected cash remaining after deposits" tone={adminSummary.actualCashDifference < 0 ? "negative" : adminSummary.actualCashDifference > 0 ? "green" : "dark"} />
          <Card title="Bank Deposit" value={peso(adminSummary.bankDeposit)} />
          <Card title="Confirmed Bank" value={peso(adminSummary.confirmedBank)} tone="green" />
          <Card title="Pending Verification" value={peso(adminSummary.pendingBank)} tone="yellow" />
          <Card title="Pending Cash On Hand" value={peso(adminSummary.pendingCashOnHand)} tone="yellow" />
          </div>
        </div>

        <div className="summary-metric-group">
          <h3>Deductions and Adjustments</h3>
          <div className="summary-metric-grid">
          <Card title="Deductions" value={peso(adminSummary.deductions)} />
          <Card title="Points Issued" value={peso(adminSummary.pointsIssued)} />
          <Card title="Points Withdrawn" value={peso(adminSummary.pointsWithdrawn)} />
          <Card title="Total PO" value={peso(adminSummary.poTotal)} />
          <Card title="Total Cash Vouchers" value={peso(adminSummary.purchaseTotal)} />
          </div>
        </div>

        <div className="summary-metric-group">
          <h3>Inventory Checks</h3>
          <div className="summary-metric-grid">
          <Card title="Pump Variance" value={liter(adminSummary.pumpVariance)} tone={varianceClass(adminSummary.pumpVariance, true)} />
          <Card title="Underground Tank Difference" value={liter(adminSummary.tankVariance)} tone={varianceClass(adminSummary.tankVariance, true)} />
          <Card title="Coke Sold" value={`${adminSummary.cokeSold} pcs`} />
          </div>
        </div>
        <CashVoucherBreakdown summary={adminSummary} />
      </Section>
      )}

      {activeDesktopCategory === "ranking" && (
      <Section id="admin-section-ranking" title="Station Ranking">
        <div className="grid four form-space">
          <Field label="Ranking Range"><SelectInput value={rankingRange} onChange={setRankingRange} options={RANKING_RANGE_OPTIONS} /></Field>
          <Card title="Range" value={rankingRangeLabel(rankingRange)} tone="dark" />
          <Card title="Reports Included" value={`${rankingReportCount}`} note="Submitted reports only" />
          <Card title="Ranking Basis" value="Liters Sold" tone="green" />
        </div>
        <Table headers={["Rank", "Station", "Submitted", "Liters Sold", "Expected Cash", "Deductions"]} minWidth="860px">
          {rankingRows.map((row, index) => (
            <tr key={row.branch}>
              <td><b>{index + 1}</b></td>
              <td><b>{row.branch}</b></td>
              <td>{row.submitted}</td>
              <td><b>{liter(row.litersSold)}</b></td>
              <td><b>{peso(row.expectedCash)}</b></td>
              <td><b>{peso(row.deductions)}</b></td>
            </tr>
          ))}
        </Table>
      </Section>
      )}
        </div>
      </div>
      </div>
    </div>
  );
}
