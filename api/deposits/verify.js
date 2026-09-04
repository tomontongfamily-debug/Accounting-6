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

export function canApproveBankDeposit(session) {
  return session?.role === "Approver" || session?.role === "Admin";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const auth = getRequestSession(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: "Please log in again before approving deposits." });
    if (!canApproveBankDeposit(auth.session)) {
      return res.status(403).json({ ok: false, error: "This login cannot approve bank deposits." });
    }

    const { branch, reportDate, shiftId, depositId } = readBody(req);
    if (!BRANCHES.includes(branch) || !SHIFT_IDS.includes(shiftId) || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate || "") || !String(depositId || "").trim()) {
      return res.status(400).json({ ok: false, error: "Invalid bank deposit approval request." });
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
      return res.status(409).json({ ok: false, error: "Only a submitted report's bank deposit can be approved." });
    }

    const deposits = Array.isArray(existingRow.data.deposits) ? existingRow.data.deposits : [];
    const target = deposits.find((deposit) => deposit.id === depositId);
    if (!target || target.removed) return res.status(404).json({ ok: false, error: "Bank deposit not found." });
    if (target.removalRequested || target.removal_requested) {
      return res.status(409).json({ ok: false, error: "This deposit has a pending change or removal request and cannot be approved." });
    }
    if (target.verified) {
      return res.status(200).json({ ok: true, alreadyVerified: true, report: approverReport(existingRow.data) });
    }

    const now = new Date().toISOString();
    const nextReport = {
      ...existingRow.data,
      deposits: deposits.map((deposit) => deposit.id === depositId ? {
        ...deposit,
        verified: true,
        verifiedAt: now,
        verifiedByRole: auth.session.role,
      } : deposit),
    };
    const nextUpdatedAt = now;
    const { data: written, error: writeError } = await supabase
      .from("fueltech_reports")
      .update({ data: nextReport, updated_at: nextUpdatedAt })
      .eq("report_key", reportKey)
      .eq("updated_at", existingRow.updated_at)
      .select("data,updated_at")
      .maybeSingle();
    if (writeError) throw writeError;
    if (!written) {
      return res.status(409).json({ ok: false, error: "This deposit changed while it was being approved. Refresh and try again." });
    }

    return res.status(200).json({ ok: true, report: approverReport(written.data), verifiedAt: now });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Unable to approve bank deposit." });
  }
}
