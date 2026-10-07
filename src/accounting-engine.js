import { additionalReviewFlags } from './accounting-review.js';
import {fuelLeakLossSummary, fuelLeakSalesForLoss, pumpLeakSales, pumpLeakLiters, pumpSaleLiters} from './fuel-leak-loss.js';
import { useEffect, useMemo, useRef, useState } from "react";
import { cashierReportDateDisplay } from "./cashier-date.js";
import { OWNER_PERIOD_OPTIONS, ownerCashTrendRows, ownerPeriodRange, ownerReportsForPeriod } from "./owner-period.js";
import { blockingPumpReadings, MAX_PUMP_LITERS_PER_SHIFT } from "./pump-reading-warnings.js";
import { committedManagerPrice, insertManagerPriceDecimal, normalizeManagerPriceDraft } from "./managerPrice.js";
import { depositAllocationDifference, physicalCashVariance } from "./cash-variance.js";
import { buildReviewMessage } from "./review-message.js";
import { formatCashCountInput, normalizeCashCountInput } from "./cash-count-input.js";
import { isStationPreOpeningSlot, isLiloanOpeningSlot, openingSlotHealth } from "./opening-health.js";
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
  return n(deductions.posRedemption) + n(deductions.cashRedemption) + n(deductions.fuelRedemption);
}

function deductionLabel(key) {
  return key === "posRedemption" ? "POS monetary redemption (automatic)" : humanizeKey(key);
}

function visibleDeductionEntries(deductions = {}) {
  return Object.entries(deductions).filter(([key]) => !HIDDEN_DEDUCTION_KEYS.has(key) && !REMOVED_DEDUCTION_KEYS.has(key) && !(Object.hasOwn(deductions, "posRedemption") && ["cashRedemption", "fuelRedemption"].includes(key)));
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

export function getEffectiveDailyPricing(priceBook, branch, date) {
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
    fuelLeakLosses: [],
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
  return n(change.newPrice) > 0 && reading >= n(row.opening) && reading <= n(row.closing);
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
    if (changeReading < currentReading) return;
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

  const leakLoss = fuelLeakLossSummary(report, row => pumpRowSales(report, row));
  const calibrationLiters = tankTotalsByProduct(report, "calibration");
  FUEL_TYPES.forEach((product) => {
    const grossLiters = n(fuelLiters[product]);
    const grossSales = n(fuelSalesByProduct[product]);
    const returnedCalibration = Math.min(grossLiters, n(calibrationLiters[product]));
    const averagePrice = grossLiters > 0 ? grossSales / grossLiters : Math.max(0, n(report.prices?.[product]));
    fuelLiters[product] = Math.max(0, grossLiters - returnedCalibration - leakLoss.meteredLiters[product]);
    fuelSalesByProduct[product] = Math.max(0, grossSales - returnedCalibration * averagePrice - leakLoss.meteredSales[product]);
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
  const pendingCashOnHand = report.pilot && Number.isFinite(report.pilotCashAwaitingDeposit)
    ? report.pilotCashAwaitingDeposit : report.demo && Number.isFinite(report.demoCashAwaitingDeposit)
    ? report.demoCashAwaitingDeposit
    : Math.max(0, expectedCash - bankDeposit);
  const actualCashCountEntered = hasActualCashCounted(report);
  const actualCashCounted = actualCashCountEntered ? n(report.actualCashCounted) : 0;
  const cashVariance = physicalCashVariance(actualCashCounted, expectedCash, actualCashCountEntered);
  const depositDifference = depositAllocationDifference(bankDeposit, pendingCashOnHand, expectedCash);
  const actualCashDifference = actualCashCountEntered ? actualCashCounted - pendingCashOnHand : 0;

  const pumpVariance = report.pumpRows.reduce((sum, row) => {
    return sum + pumpVarianceAmount(report, row);
  }, 0);

  const tankOutflowLiters = Object.fromEntries(FUEL_TYPES.map(product => [product, fuelLiters[product] + leakLoss.meteredLiters[product]]));
  const tankRows = report.tankRows.map((row) => {
    const unadjustedExpectedDip = n(row.opening) + n(row.delivery) - tankOutflowLiters[row.product] - n(row.pullOut);
    const expectedDip = unadjustedExpectedDip - leakLoss.tankLiters[row.product];
    return { ...row, expectedDip, unadjustedExpectedDip,
      leakLossLiters: leakLoss.meteredLiters[row.product] + leakLoss.tankLiters[row.product],
      unmeteredLeakLossLiters: leakLoss.tankLiters[row.product],
      unadjustedVariance: tankVarianceAmount(report, row, unadjustedExpectedDip),
      variance: tankVarianceAmount(report, row, expectedDip) };
  });

  return {
    fuelLiters,
    fuelSalesByProduct,
    tankOutflowLiters,
    fuelLeakLossLiters: leakLoss.liters,
    fuelLeakLossSales: leakLoss.sales,
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

  const flags = additionalReviewFlags(report);
  const hasHighPumpReading = (report.pumpRows || []).some((row) => pumpLitersSold(row) > REVIEW_LITERS_THRESHOLD);
  if (hasHighPumpReading || n(result.totalLiters) > REVIEW_LITERS_THRESHOLD) flags.push("High liters sold");
  const cashVariance = n(result.cashVariance);
  if (cashVariance > REVIEW_CASH_OVERAGE_THRESHOLD || cashVariance < -REVIEW_CASH_VARIANCE_THRESHOLD) {
    flags.push("High cash variance");
  }
  return [...new Set(flags)];
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
    sum.fuelLeakLossLiters += result.fuelLeakLossLiters;
    sum.fuelLeakLossSales += result.fuelLeakLossSales;
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
    fuelLeakLossLiters: 0,
    fuelLeakLossSales: 0,
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
  if ((report.fuelLeakLosses || []).some(loss => n(loss.liters) > 0)) return true;
  if (String(report.cashierName || "").trim()) return true;
  if ((report.pumpRows || []).some((row) => row.closingEntered || row.closingEntrySource === "cashier")) return true;
  if ((report.tankRows || []).some((row) => [row.delivery, row.pullOut, row.calibration, row.actualDip].some((value) => n(value) !== 0))) return true;
  if (Object.values(report.deductions || {}).some((value) => n(value) !== 0)) return true;
  if ((report.poRows || []).length > 0 || (report.purchaseRows || []).length > 0) return true;
  return report.actualCashCounted !== "" && report.actualCashCounted !== undefined && report.actualCashCounted !== null;
}

function stationShiftHealth(report, branch, date, shiftId) {
  const openingStatus = openingSlotHealth(report, branch, date, shiftId);
  if (openingStatus) return openingStatus;
  if (isStationPreOpeningSlot(branch, date, shiftId)) return { label: "Not Required", tone: "green" };
  if (!report) return { label: "Missing", tone: "red" };
  if (openingSetupCompleted(report)) return { label: "Submitted", tone: "green", detail: "Opening Setup" };
  if (!report.confirmed && !hasMeaningfulDraftEntries(report)) return { label: "Missing", tone: "red" };
  if (!report.confirmed) return { label: "Draft", tone: "yellow" };
  const result = compute(report);
  if (report.pilot) return { label: "Submitted", tone: "green", needsReview: Boolean(report.checkRequired || report.checkDetails?.length || report.checkCategories?.length) };
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
      if (status.needsReview) counts["Check Required"] = n(counts["Check Required"]) + 1;
    });
    return counts;
  }, {});
}

function depositHealthStatus(report, branch, date, shiftId) {
  if (isLiloanOpeningSlot(branch, date, shiftId) && openingSlotHealth(report, branch, date, shiftId)?.label === "Submitted") return { label: "Not Required", tone: "green" };
  if (isStationPreOpeningSlot(branch, date, shiftId)) return { label: "Not Required", tone: "green" };
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
    totals[row.pump][row.product] = n(totals[row.pump][row.product]) + pumpSaleLiters(report, row);
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
      ...["FUELTECH PAY TOTAL", "PO", "CASH VOUCHER", "CASH / POS MONETARY REDEEM", "FUEL REDEEM", "COKE RELEASE", "POINTS ISSUED", "POINTS WITHDRAWN"].map((label) => excelCell(label, "SubHeader")),
    ]),
    totalRow("TOTAL", [
      summary.fuelTechPayTotal,
      summary.poTotal,
      summary.purchaseTotal,
      exportReports.reduce((sum, report) => sum + (n(report.deductions?.cashRedemption) + n(report.deductions?.posRedemption)), 0),
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
        excelCell((n(report.deductions?.cashRedemption) + n(report.deductions?.posRedemption))), excelCell(n(report.deductions?.fuelRedemption)), excelCell(result.cokeSold),
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
      ...["BRANCH", "DATE", "SHIFT", "TOTAL SALES IN LITERS", "FUEL SALES", "OIL SALES", "GROSS SALES", "TOTAL FUEL REDEMPTION", "TOTAL CASH / POS MONETARY REDEMPTION", "TOTAL COKE REDEMPTION", "POINTS ISSUED", "POINTS WITHDRAWN", "TOTAL REDEMPTION", "BANK DEPOSIT", "EXPECTED CASH", "SYSTEM VARIANCE"].map((label) => excelCell(label, "Header")),
    ]),
    totalRow("TOTAL", [
      "", "",
      summary.totalLiters,
      summary.fuelSales,
      summary.oilSales,
      summary.grossSales,
      exportReports.reduce((sum, report) => sum + n(report.deductions?.fuelRedemption), 0),
      exportReports.reduce((sum, report) => sum + (n(report.deductions?.cashRedemption) + n(report.deductions?.posRedemption)), 0),
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
      const totalRedemption = n(report.deductions?.fuelRedemption) + (n(report.deductions?.cashRedemption) + n(report.deductions?.posRedemption)) + result.cokeSold;
      return excelRow([
        excelCell(report.branch, "Text"), excelCell(report.date, "Text"), excelCell(shortShiftLabel(report.shiftId), "Text"),
        excelCell(result.totalLiters), excelCell(result.fuelSales), excelCell(n(report.oilSales)), excelCell(result.grossSales),
        excelCell(n(report.deductions?.fuelRedemption)), excelCell((n(report.deductions?.cashRedemption) + n(report.deductions?.posRedemption))), excelCell(result.cokeSold),
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
    sheetTitle("PUMP NOZZLE DETAIL", 16),
    excelRow(["BRANCH", "DATE", "SHIFT", "PUMP", "NOZZLE", "PRODUCT", "OPENING", "CLOSING", "METERED LITERS", "LEAK LOSS (L)", "LITERS SOLD", "NEGATIVE VARIANCE", "PUMP PRICE", "ESTIMATED SALES", "CASHIER", "REPORT STATUS"].map((label) => excelCell(label, "Header"))),
    ...exportReports.flatMap((report) => (report.pumpRows || []).map((row) => {
      const meteredLiters = pumpLitersSold(row);
      const litersSold = pumpSaleLiters(report, row);
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
        excelCell(meteredLiters),
        excelCell(pumpLeakLiters(report, row)),
        excelCell(litersSold),
        excelCell(negativeVariance, negativeVariance < 0 ? "RedValue" : "Cell"),
        excelCell(pumpPrice),
        excelCell(Math.max(0, pumpRowSales(report, row) - pumpLeakSales(report, row, pump => pumpRowSales(report, pump)))),
        excelCell(report.cashierName || "", "Text"),
        excelCell(reportStatusText(report), "Text"),
      ]);
    })),
  ];

  const tankLedgerRows = [
    sheetTitle("TANK INVENTORY DETAIL", 18),
    excelRow(["BRANCH", "DATE", "SHIFT", "TANK", "PRODUCT", "PREVIOUS DIP", "DELIVERY", "PULL OUT", "CALIBRATION", "NET PUMP OUTFLOW", "FUEL LEAK LOSS (L)", "OUTSIDE METER LOSS (L)", "EXPECTED DIP", "ACTUAL DIP", "ORIGINAL DIFFERENCE", "REFERENCE DIFFERENCE", "CASHIER", "REPORT STATUS"].map((label) => excelCell(label, "Header"))),
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
        excelCell(n(result.tankOutflowLiters[row.product])),
        excelCell(n(row.leakLossLiters)),
        excelCell(n(row.unmeteredLeakLossLiters)),
        excelCell(n(row.expectedDip)),
        excelCell(n(row.actualDip)),
        excelCell(n(row.unadjustedVariance)),
        excelCell(n(row.variance), n(row.variance) < 0 ? "RedValue" : "Cell"),
        excelCell(report.cashierName || "", "Text"),
        excelCell(reportStatusText(report), "Text"),
      ]));
    }),
  ];

  const leakLedgerRows = [
    sheetTitle("FUEL LEAK LOSS", 10),
    excelRow(["BRANCH", "DATE", "SHIFT", "PRODUCT", "LOSS SOURCE", "LEAK LOSS (L)", "METERED SALES EXCLUDED (PHP)", "EXPLANATION", "RECORDED BY", "RECORDED AT"].map(label => excelCell(label, "Header"))),
    ...exportReports.flatMap(report => (report.fuelLeakLosses || []).map(loss => {
      const pump = report.pumpRows.find(row => row.id === loss.pumpRowId);
      return excelRow([
        excelCell(report.branch, "Text"), excelCell(report.date, "Text"), excelCell(shortShiftLabel(report.shiftId), "Text"),
        excelCell(loss.product, "Text"), excelCell(pump ? pump.pump + " / " + pump.nozzle + " (metered)" : "Tank / piping (outside meter)", "Text"),
        excelCell(n(loss.liters)), excelCell(fuelLeakSalesForLoss(report, loss, row => pumpRowSales(report, row))),
        excelCell(loss.notes || "", "Text"), excelCell(loss.recordedBy || "", "Text"), excelCell(loss.recordedAt || "", "Text"),
      ]);
    })),
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
    excelWorksheet("PUMP NOZZLE DETAIL", [92, 78, 96, 86, 90, 86, 94, 94, 94, 94, 94, 108, 90, 104, 120, 120], pumpLedgerRows),
    excelWorksheet("DIP REFERENCE DETAIL", [92, 78, 96, 120, 86, 96, 96, 86, 92, 92, 92, 92, 100, 94, 94, 94, 120, 120], tankLedgerRows),
    excelWorksheet("FUEL LEAK LOSS", [92, 78, 96, 86, 180, 100, 160, 260, 160, 170], leakLedgerRows),
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
      ...change,
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


export { compute, createReport, carryForwardOpenings, getEffectivePricing, normalizeReport, reportKey, buildPumpRows, BRANCHES, PUMP_LAYOUTS, getCurrentShift };
