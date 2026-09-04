import { randomUUID } from "node:crypto";
import { BRANCHES, SHIFT_IDS, readBody, supabaseAdmin } from "../_shared/supabase.js";
import { canWriteBranch, getRequestSession } from "../_shared/session.js";
import { normalizeCashCountInput } from "../../src/cash-count-input.js";
import { sendCorrectionRequestNotification } from "../_shared/push.js";
import { authoritativePoRowsForReport } from "../_shared/po.js";

const LEASE_MS = 2 * 60_000;
const CLEAN_START_DATE = "2026-07-29";
const BRANCH_DATA_VERSIONS = {
  Mabolo: "2026-07-31-rewind-to-july-30-1",
  Arpili: "2026-07-30-arpili-opening-reset-2",
  Liloan: "2026-07-31-rewind-to-july-30-1",
  Pondol: "2026-07-30-global-reset-1",
  Barili: "2026-07-30-global-reset-1",
  Moalboal: "2026-07-30-global-reset-1",
};
const MAX_PUMP_LITERS_PER_SHIFT = 1500;
const CASH_VOUCHER_START_DATE = "2026-07-29";
const CASH_VOUCHER_CATEGORIES = new Set(["OPEX", "Personal", "Construction"]);

function reportKeyFor(report) {
  return `${report.branch}__${report.date}__${report.shiftId}`;
}

async function loadExistingReport(supabase, reportKey) {
  const { data, error } = await supabase
    .from("fueltech_reports")
    .select("data,updated_at")
    .eq("report_key", reportKey)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export function mergeReportForRole(session, incomingReport, existingReport = {}) {
  if (session.role === "Admin") return incomingReport;
  if (session.role === "Cashier") {
    return {
      ...incomingReport,
      pumpRows: Array.isArray(incomingReport.pumpRows) && incomingReport.pumpRows.length > 0 ? incomingReport.pumpRows : existingReport.pumpRows || [],
      tankRows: Array.isArray(incomingReport.tankRows) && incomingReport.tankRows.length > 0 ? incomingReport.tankRows : existingReport.tankRows || [],
      deposits: existingReport.deposits || [],
      midShiftPriceChanges: existingReport.midShiftPriceChanges || [],
      midShiftBasePrices: existingReport.midShiftBasePrices || incomingReport.midShiftBasePrices || incomingReport.prices || {},
    };
  }
  if (session.role === "Manager") {
    const baseReport = existingReport.branch ? existingReport : {
      branch: incomingReport.branch,
      date: incomingReport.date,
      shiftId: incomingReport.shiftId,
      confirmed: false,
    };
    return {
      ...baseReport,
      branch: incomingReport.branch,
      date: incomingReport.date,
      shiftId: incomingReport.shiftId,
      deposits: incomingReport.deposits || [],
      midShiftPriceChanges: incomingReport.midShiftPriceChanges || [],
      midShiftBasePrices: existingReport.midShiftBasePrices || incomingReport.midShiftBasePrices || incomingReport.prices || {},
    };
  }
  return existingReport;
}

function validNumber(value) {
  return value !== "" && Number.isFinite(Number(value));
}

export function validOpeningReading(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return value !== "" && value !== null && value !== undefined
    && Number.isFinite(Number(value))
    && Number(value) >= 0;
}

function validateOpeningReadings(report) {
  if (!report.baselineReport || !report.baselineConfirmed) return "";
  if (!Array.isArray(report.pumpRows) || report.pumpRows.length === 0) return "Pump opening readings are required.";
  if (!Array.isArray(report.tankRows) || report.tankRows.length === 0) return "Underground tank opening readings are required.";
  if (report.pumpRows.some((row) => !validOpeningReading(row.opening))) {
    return "Complete every pump opening reading. Type 0 when the checked reading is genuinely zero.";
  }
  if (report.tankRows.some((row) => !validOpeningReading(row.opening))) {
    return "Complete every underground tank opening reading. Type 0 when the checked inventory is genuinely zero.";
  }
  return "";
}

export function validateSubmission(report) {
  if (!String(report.cashierName || "").trim()) return "Cashier name is required.";
  if (!Array.isArray(report.pumpRows) || report.pumpRows.length === 0) return "Pump readings are required.";
  for (const row of report.pumpRows) {
    if (!row.closingEntered) return `${row.pump || "Pump"} ${row.nozzle || "reading"}: current closing must be entered.`;
    if (!row.id || !validNumber(row.opening) || !validNumber(row.closing)) return `${row.pump || "Pump"} ${row.nozzle || "reading"} is incomplete.`;
    if (Number(row.opening) <= 0) return `${row.pump} ${row.nozzle}: previous closing is missing.`;
    const litersSold = Number(row.closing) - Number(row.opening);
    if (litersSold < 0) return `${row.pump} ${row.nozzle} (${row.product}): negative liters are not allowed. Current closing cannot be below previous closing.`;
    if (litersSold > MAX_PUMP_LITERS_PER_SHIFT) return `${row.pump} ${row.nozzle} (${row.product}): ${litersSold.toFixed(2)} liters is too high or unusual and exceeds the ${MAX_PUMP_LITERS_PER_SHIFT.toLocaleString("en-US")} L maximum for one shift.`;
    if (litersSold > 0 && Number(report.prices?.[row.product]) <= 0) return `${row.product}: pump price is missing or zero.`;
  }
  if (!Array.isArray(report.tankRows) || report.tankRows.some((row) => !validNumber(row.actualDip))) return "Underground tank readings are incomplete.";
  if (!validNumber(report.actualCashCounted)) return "End-of-shift cash count is required.";
  if (report.date >= CASH_VOUCHER_START_DATE) {
    for (const row of report.purchaseRows || []) {
      if (!CASH_VOUCHER_CATEGORIES.has(row.category)) return "Every cash voucher needs an OPEX, Personal, or Construction category.";
      if (!String(row.item || "").trim()) return "Every cash voucher needs a particular.";
      if (!validNumber(row.amount) || Number(row.amount) <= 0) return "Every cash voucher needs an amount greater than zero.";
    }
  }
  return "";
}

function previousShift(report) {
  if (report.shiftId === "shift-2") return { date: report.date, shiftId: "shift-1" };
  if (report.shiftId === "shift-3") return { date: report.date, shiftId: "shift-2" };
  const date = new Date(`${report.date}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return { date: date.toISOString().slice(0, 10), shiftId: "shift-3" };
}

function pumpKey(row = {}) {
  return `${row.pump}|${row.nozzle}|${row.product}`;
}

async function validateContinuity(supabase, report) {
  if (report.baselineReport) return "";
  const previous = previousShift(report), previousKey = `${report.branch}__${previous.date}__${previous.shiftId}`;
  const { data, error } = await supabase.from("fueltech_reports").select("data").eq("report_key", previousKey).maybeSingle();
  if (error) throw error;
  const previousReport = data?.data || {};
  if (!previousReport.confirmed && !previousReport.baselineReport) {
    return `Complete ${previous.date} ${previous.shiftId.replace("shift-", "Shift ")} before submitting this report.`;
  }
  const previousRows = Object.fromEntries((previousReport.pumpRows || []).map((row) => [pumpKey(row), row]));
  for (const row of report.pumpRows || []) {
    const previousRow = previousRows[pumpKey(row)];
    if (previousRow && Math.abs(Number(row.opening) - Number(previousRow.closing)) > 0.001) {
      return `${row.pump} ${row.nozzle}: previous closing does not match the confirmed preceding shift.`;
    }
  }
  return "";
}

async function validateOpeningSetup(supabase, report, existingReport, reportKey) {
  if (!report.baselineReport || existingReport.baselineReport) return "";
  const { data, error } = await supabase
    .from("fueltech_reports")
    .select("report_key,data")
    .eq("branch", report.branch);
  if (error) throw error;
  const hasEarlierCompletedReport = (data || []).some((row) =>
    row.report_key !== reportKey && (row.data?.confirmed || row.data?.baselineReport)
  );
  return hasEarlierCompletedReport
    ? "Opening setup can only be confirmed as the station's first completed report."
    : "";
}

function activeOtherLease(existingReport, clientId) {
  const lease = existingReport?.serverMeta?.editLease;
  if (!lease || lease.clientId === clientId || Date.parse(lease.expiresAt || "") <= Date.now()) return null;
  return lease;
}

function isStaleSameClientSave(incomingSave = {}, existingMeta = {}) {
  return Boolean(
    incomingSave.clientId
    && incomingSave.clientId === existingMeta.lastClientId
    && Number(incomingSave.version || 0) <= Number(existingMeta.lastClientVersion || 0)
  );
}

function draftProgress(report = {}) {
  return {
    pumpClosings: (report.pumpRows || []).filter((row) => row.closingEntered).length,
    tankReadings: (report.tankRows || []).filter((row) => row.actualDip !== "" && row.actualDip !== null && row.actualDip !== undefined).length,
    cashierName: String(report.cashierName || "").trim() ? 1 : 0,
    cashCount: report.actualCashCounted !== "" && report.actualCashCounted !== null && report.actualCashCounted !== undefined ? 1 : 0,
  };
}

export function erasesCompletedDraftFields(incomingReport, existingReport) {
  const incoming = draftProgress(incomingReport), existing = draftProgress(existingReport);
  return Object.keys(existing).some((field) => incoming[field] < existing[field]);
}

function nextReportId(report) {
  return `FT-${report.branch.slice(0, 3).toUpperCase()}-${report.date.replaceAll("-", "")}-${report.shiftId.slice(-1)}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

async function loadAuthoritativeSellingPricing(supabase, report) {
  const { data, error } = await supabase
    .from("fueltech_price_book")
    .select("effective_date,coverage,shift_id,prices")
    .eq("branch", report.branch)
    .lte("effective_date", report.date)
    .order("effective_date", { ascending: false });
  if (error) throw error;

  const rows = data || [];
  const selected = rows.find((row) =>
    row.effective_date === report.date
    && row.coverage === "Shift"
    && row.shift_id === report.shiftId
  ) || rows.find((row) => row.coverage === "Daily" && row.shift_id === "daily");
  if (!selected) return null;

  return {
    prices: Object.fromEntries(["Premium", "Regular", "Diesel"].map((product) => [
      product,
      Number(selected.prices?.[product] || 0),
    ])),
    pricingCoverage: selected.coverage,
    pricingEffectiveDate: selected.effective_date,
    pricingShiftId: selected.coverage === "Shift" ? selected.shift_id : "",
  };
}

function reportPayload(report, serverMeta) {
  return {
    report_key: reportKeyFor(report),
    branch: report.branch,
    report_date: report.date,
    shift_id: report.shiftId,
    data: { ...report, serverMeta },
    updated_at: new Date().toISOString(),
  };
}

export function reportWithPendingCorrection(existingReport = {}, incomingReport = {}, nowIso = new Date().toISOString(), requestId = randomUUID()) {
  const currentRequest = existingReport.correctionRequest || {};
  const reason = String(incomingReport.correctionRequest?.reason || "").trim();
  return {
    ...(existingReport.branch ? existingReport : incomingReport),
    correctionRequest: {
      id: currentRequest.status === "pending" && currentRequest.id ? currentRequest.id : requestId,
      status: "pending",
      branch: incomingReport.branch,
      reportDate: incomingReport.date,
      shiftId: incomingReport.shiftId,
      reason,
      requestedAt: nowIso,
      approvedAt: "",
      rejectedAt: "",
      expiresAt: "",
      completedAt: "",
    },
  };
}

async function atomicWrite(supabase, payload, existingRow) {
  if (!existingRow) {
    const { data, error } = await supabase.from("fueltech_reports").insert(payload).select("data,updated_at").single();
    if (error?.code === "23505") return null;
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from("fueltech_reports")
    .update(payload)
    .eq("report_key", payload.report_key)
    .eq("updated_at", existingRow.updated_at)
    .select("data,updated_at")
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const auth = getRequestSession(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: "Please log in again before saving." });

    const { report, operation = "save" } = readBody(req);
    if (!report || !BRANCHES.includes(report.branch) || !SHIFT_IDS.includes(report.shiftId) || !/^\d{4}-\d{2}-\d{2}$/.test(report.date || "")) {
      return res.status(400).json({ ok: false, error: "Invalid report." });
    }
    if (report.date < CLEAN_START_DATE) return res.status(409).json({ ok: false, error: "This report is from before the clean restart and cannot be uploaded." });
    if (!canWriteBranch(auth.session, report.branch)) return res.status(403).json({ ok: false, error: "This login cannot save this station." });
    if (!["save", "submit", "request-correction"].includes(operation)) {
      return res.status(400).json({ ok: false, error: "Invalid report operation." });
    }
    if (operation === "submit" && auth.session.role !== "Cashier" && auth.session.role !== "Admin") {
      return res.status(403).json({ ok: false, error: "Only cashier or admin can submit reports." });
    }

    const reportKey = reportKeyFor(report), supabase = supabaseAdmin(), existingRow = await loadExistingReport(supabase, reportKey);
    const existingReport = existingRow?.data || {}, existingMeta = existingReport.serverMeta || {}, incomingSave = report.clientSave || {};
    const requiredBranchDataVersion = BRANCH_DATA_VERSIONS[report.branch] || "";
    if (requiredBranchDataVersion && incomingSave.branchDataVersion !== requiredBranchDataVersion) {
      return res.status(409).json({
        ok: false,
        resetSave: true,
        error: "This station was restarted. Refresh the app before entering the new opening setup.",
      });
    }
    if (operation === "request-correction") {
      if (auth.session.role !== "Cashier" && auth.session.role !== "Admin") {
        return res.status(403).json({ ok: false, error: "Only cashier or admin can request a report correction." });
      }
      if (!String(report.correctionRequest?.reason || "").trim()) {
        return res.status(422).json({ ok: false, error: "Please enter the reason for the correction request." });
      }

      const now = new Date();
      const currentVersion = Number(existingMeta.version || 0);
      const nextVersion = currentVersion + 1;
      const safeReport = reportWithPendingCorrection(existingReport, report, now.toISOString());
      if (!existingRow) {
        safeReport.confirmed = false;
        safeReport.confirmedAt = "";
        safeReport.baselineReport = false;
        safeReport.baselineConfirmed = false;
      }
      const serverMeta = {
        ...existingMeta,
        version: nextVersion,
        lastMutationId: incomingSave.mutationId || randomUUID(),
        lastClientId: incomingSave.clientId || "",
        lastClientVersion: Number(incomingSave.version || 0),
      };
      const written = await atomicWrite(supabase, reportPayload(safeReport, serverMeta), existingRow);
      if (!written) return res.status(409).json({ ok: false, conflict: true, error: "This report changed while the correction request was being saved. Please try again." });
      await sendCorrectionRequestNotification(supabase, written.data).catch(() => {});
      return res.status(200).json({
        ok: true,
        report: written.data,
        reportId: serverMeta.reportId || "",
        version: nextVersion,
        locked: Boolean(serverMeta.lockedAt),
      });
    }
    const openingSetupError = await validateOpeningSetup(supabase, report, existingReport, reportKey);
    if (openingSetupError) return res.status(422).json({ ok: false, error: openingSetupError });
    const openingReadingsError = validateOpeningReadings(report);
    if (openingReadingsError) return res.status(422).json({ ok: false, error: openingReadingsError });
    if (existingMeta.lastMutationId && existingMeta.lastMutationId === incomingSave.mutationId) {
      return res.status(200).json({ ok: true, duplicateIgnored: true, report: existingReport, reportId: existingMeta.reportId || "", version: existingMeta.version || 0, locked: Boolean(existingMeta.lockedAt) });
    }
    if (isStaleSameClientSave(incomingSave, existingMeta)) {
      return res.status(409).json({ ok: false, staleSave: true, error: "This device sent an older draft save. The draft remains on the device and must be retried.", version: existingMeta.version || 0 });
    }
    const completedOpeningSetup = existingReport.baselineReport && existingReport.baselineConfirmed;
    if (auth.session.role === "Cashier" && (existingReport.confirmed || completedOpeningSetup)) {
      return res.status(423).json({ ok: false, error: "This submitted report is locked. Request an admin correction to change it.", reportId: existingMeta.reportId || "" });
    }
    const otherLease = activeOtherLease(existingReport, incomingSave.clientId);
    if (auth.session.role === "Cashier" && otherLease) {
      return res.status(409).json({ ok: false, conflict: true, error: `This report is open on another device${otherLease.actor ? ` by ${otherLease.actor}` : ""}.`, editor: otherLease });
    }
    const expectedVersion = Number(incomingSave.baseVersion || 0), currentVersion = Number(existingMeta.version || 0);
    const sameClientNewer = incomingSave.clientId && incomingSave.clientId === existingMeta.lastClientId && Number(incomingSave.version || 0) > Number(existingMeta.lastClientVersion || 0);
    if (existingRow && expectedVersion !== currentVersion && sameClientNewer && erasesCompletedDraftFields(report, existingReport)) {
      return res.status(409).json({
        ok: false,
        conflict: true,
        staleDraft: true,
        error: "A newer online draft contains more completed fields. Reload the report before continuing.",
        version: currentVersion,
      });
    }
    if (existingRow && expectedVersion !== currentVersion && !sameClientNewer) {
      return res.status(409).json({ ok: false, conflict: true, error: "A newer version of this report is already online. Reload before editing.", version: currentVersion });
    }

    const safeReport = mergeReportForRole(auth.session, report, existingReport);
    safeReport.poRows = await authoritativePoRowsForReport(supabase, safeReport);
    if (safeReport.date >= "2026-08-19") safeReport.poSource = "FuelTech Pay";
    if (safeReport.actualCashCounted !== "" && safeReport.actualCashCounted !== null && safeReport.actualCashCounted !== undefined) {
      const normalizedCashCount = normalizeCashCountInput(safeReport.actualCashCounted);
      if (normalizedCashCount === null) {
        return res.status(422).json({ ok: false, error: "End-of-shift cash count is not a valid amount." });
      }
      safeReport.actualCashCounted = normalizedCashCount;
    }
    if (auth.session.role === "Cashier" && operation !== "submit") {
      safeReport.confirmed = false;
      safeReport.confirmedAt = "";
    }
    if (operation === "submit") {
      const authoritativePricing = await loadAuthoritativeSellingPricing(supabase, safeReport);
      if (authoritativePricing) {
        safeReport.prices = { ...(safeReport.prices || {}), ...authoritativePricing.prices };
        safeReport.pricingCoverage = authoritativePricing.pricingCoverage;
        safeReport.pricingEffectiveDate = authoritativePricing.pricingEffectiveDate;
        safeReport.pricingShiftId = authoritativePricing.pricingShiftId;
      }
      const validationError = validateSubmission(safeReport);
      if (validationError) return res.status(422).json({ ok: false, error: validationError });
      const continuityError = await validateContinuity(supabase, safeReport);
      if (continuityError) return res.status(422).json({ ok: false, error: continuityError });
      safeReport.confirmed = true;
      safeReport.confirmedAt = new Date().toISOString();
    }
    const now = new Date(), nextVersion = currentVersion + 1;
    const serverMeta = {
      ...existingMeta,
      version: nextVersion,
      savedAt: now.toISOString(),
      reportId: operation === "submit" ? (existingMeta.reportId || nextReportId(safeReport)) : (existingMeta.reportId || ""),
      lockedAt: operation === "submit" ? now.toISOString() : (auth.session.role === "Admin" && !safeReport.confirmed ? "" : existingMeta.lockedAt || ""),
      lastMutationId: incomingSave.mutationId || randomUUID(),
      lastClientId: incomingSave.clientId || "",
      lastClientVersion: Number(incomingSave.version || 0),
      editLease: operation === "submit" ? null : incomingSave.clientId ? { clientId: incomingSave.clientId, actor: String(safeReport.cashierName || "Cashier").trim(), expiresAt: new Date(now.getTime() + LEASE_MS).toISOString() } : existingMeta.editLease || null,
    };
    const written = await atomicWrite(supabase, reportPayload(safeReport, serverMeta), existingRow);
    if (!written) return res.status(409).json({ ok: false, conflict: true, error: "Another device saved this report first. Reload before continuing." });
    return res.status(200).json({ ok: true, report: written.data, reportId: serverMeta.reportId, version: nextVersion, locked: Boolean(serverMeta.lockedAt) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Unable to save report." });
  }
}
