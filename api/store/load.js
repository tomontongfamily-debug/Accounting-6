import { supabaseAdmin } from "../_shared/supabase.js";
import { getRequestSession } from "../_shared/session.js";
import { attachAuthoritativePoRows } from "../_shared/po.js";

const PUBLIC_PRICE_FIELDS = new Set(["Premium", "Regular", "Diesel", "confirmed", "confirmedAt"]);

export function pricesForRole(prices, role) {
  if (role === "Approver") return {};
  if (role === "Admin") return prices || {};
  return Object.fromEntries(Object.entries(prices || {}).filter(([key]) => PUBLIC_PRICE_FIELDS.has(key)));
}

export function reportForRole(report, role) {
  if (role === "Approver") {
    return {
      confirmed: Boolean(report?.confirmed),
      openingSetupComplete: Boolean(
        (report?.baselineConfirmed === true || report?.baseline_confirmed === true)
        && report?.baselineReport === true
      ),
      deposits: (report?.deposits || []).map((deposit) => ({
        id: deposit.id,
        groupId: deposit.groupId || "",
        bank: deposit.bank || "",
        reference: deposit.reference || "",
        amount: Number(deposit.amount || 0),
        totalDepositAmount: Number(deposit.totalDepositAmount || 0),
        depositDate: deposit.depositDate || "",
        salesDateCovered: deposit.salesDateCovered || "",
        coverage: deposit.coverage || "",
        coverageLabel: deposit.coverageLabel || "",
        coveredShiftIds: Array.isArray(deposit.coveredShiftIds) ? deposit.coveredShiftIds : [],
        verified: Boolean(deposit.verified),
        verifiedAt: deposit.verifiedAt || "",
        verifiedByRole: deposit.verifiedByRole || "",
        removalRequested: Boolean(deposit.removalRequested || deposit.removal_requested),
        removal_requested: Boolean(deposit.removalRequested || deposit.removal_requested),
        removalRequestType: deposit.removalRequestType === "change" ? "change" : "removal",
        removed: Boolean(deposit.removed),
      })),
    };
  }
  if (role !== "Cashier") return report;
  return { ...report, deposits: [] };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const auth = getRequestSession(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, error: "Please log in again before loading reports." });
      return;
    }

    const supabase = supabaseAdmin();
    const reportQuery = supabase
      .from("fueltech_reports")
      .select("report_key,branch,report_date,shift_id,data,updated_at");
    const priceQuery = supabase
      .from("fueltech_price_book")
      .select("branch,effective_date,coverage,shift_id,prices,updated_at");

    if (auth.session.role !== "Admin" && auth.session.role !== "Approver") {
      reportQuery.eq("branch", auth.session.branch);
      priceQuery.eq("branch", auth.session.branch);
    }

    const [{ data: priceRows, error: priceError }, { data: reportRows, error: reportError }] = await Promise.all([
      auth.session.role === "Approver" ? Promise.resolve({ data: [], error: null }) : priceQuery,
      reportQuery,
    ]);

    if (priceError) {
      res.status(500).json({ ok: false, error: priceError.message });
      return;
    }

    if (reportError) {
      res.status(500).json({ ok: false, error: reportError.message });
      return;
    }

    const authoritativeReportRows = auth.session.role === "Approver"
      ? reportRows || []
      : await attachAuthoritativePoRows(supabase, reportRows || [], auth.session.role === "Admin" ? "" : auth.session.branch);

    res.status(200).json({
      ok: true,
      priceRows: (priceRows || []).map((row) => ({ ...row, prices: pricesForRole(row.prices, auth.session.role) })),
      reportRows: authoritativeReportRows.map((row) => ({ ...row, data: reportForRole(row.data, auth.session.role) })),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Unable to load online data." });
  }
}
