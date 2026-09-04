import { BRANCHES, SHIFT_IDS, readBody, supabaseAdmin } from "../_shared/supabase.js";
import { getRequestSession } from "../_shared/session.js";

function reportKeyFor(branch, date, shiftId) {
  return `${branch}__${date}__${shiftId}`;
}

function approverReport(report = {}) {
  return {
    branch: report.branch,
    date: report.date,
    shiftId: report.shiftId,
    confirmed: Boolean(report.confirmed),
    deposits: report.deposits || [],
  };
}

export function canReviewDepositRemoval(session) {
  return session?.role === "Approver" || session?.role === "Admin";
}

export function reviewedDeposit(deposit, decision, role, now) {
  if (decision === "approve") {
    return {
      ...deposit,
      removalRequested: false,
      removal_requested: false,
      removalRequestType: "",
      removed: true,
      removedAt: now,
      removedByRole: role,
    };
  }
  return {
    ...deposit,
    removalRequested: false,
    removal_requested: false,
    removalRequestType: "",
    removalRejectedAt: now,
    removalRejectedByRole: role,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const auth = getRequestSession(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: "Please log in again before reviewing deposit requests." });
    if (!canReviewDepositRemoval(auth.session)) {
      return res.status(403).json({ ok: false, error: "This login cannot review deposit removal requests." });
    }

    const { branch, reportDate, shiftId, depositId, decision } = readBody(req);
    if (
      !BRANCHES.includes(branch)
      || !SHIFT_IDS.includes(shiftId)
      || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate || "")
      || !String(depositId || "").trim()
      || !["approve", "reject"].includes(decision)
    ) {
      return res.status(400).json({ ok: false, error: "Invalid deposit removal review request." });
    }

    const reportKey = reportKeyFor(branch, reportDate, shiftId);
    const supabase = supabaseAdmin();
    const { data: existingRow, error: loadError } = await supabase
      .from("fueltech_reports")
      .select("data,updated_at")
      .eq("report_key", reportKey)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!existingRow?.data?.confirmed) {
      return res.status(409).json({ ok: false, error: "Only a submitted report's deposit request can be reviewed." });
    }

    const deposits = Array.isArray(existingRow.data.deposits) ? existingRow.data.deposits : [];
    const target = deposits.find((deposit) => deposit.id === depositId);
    if (!target || target.removed) return res.status(404).json({ ok: false, error: "Bank deposit not found." });
    if (!target.removalRequested && !target.removal_requested) {
      return res.status(409).json({ ok: false, error: "This bank deposit has no pending removal or change request." });
    }

    const now = new Date().toISOString();
    const nextReport = {
      ...existingRow.data,
      deposits: deposits.map((deposit) =>
        deposit.id === depositId ? reviewedDeposit(deposit, decision, auth.session.role, now) : deposit
      ),
    };
    const { data: written, error: writeError } = await supabase
      .from("fueltech_reports")
      .update({ data: nextReport, updated_at: now })
      .eq("report_key", reportKey)
      .eq("updated_at", existingRow.updated_at)
      .select("data,updated_at")
      .maybeSingle();
    if (writeError) throw writeError;
    if (!written) {
      return res.status(409).json({ ok: false, error: "This deposit changed while the request was being reviewed. Refresh and try again." });
    }

    return res.status(200).json({
      ok: true,
      decision,
      reviewedAt: now,
      report: approverReport(written.data),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Unable to review deposit removal request." });
  }
}
