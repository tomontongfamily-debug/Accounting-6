import { BRANCHES, SHIFT_IDS, readBody, supabaseAdmin } from "../_shared/supabase.js";
import { canWriteBranch, getRequestSession } from "../_shared/session.js";

const LEASE_MS = 2 * 60_000;
const CLEAN_START_DATE = "2026-07-29";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const auth = getRequestSession(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: "Please log in again." });
    const { branch, date, shiftId, clientId, actor = "Cashier", action = "acquire" } = readBody(req);
    if (auth.session.role !== "Cashier" || !canWriteBranch(auth.session, branch)) return res.status(403).json({ ok: false, error: "Cashier station access required." });
    if (!BRANCHES.includes(branch) || !SHIFT_IDS.includes(shiftId) || !/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !clientId) return res.status(400).json({ ok: false, error: "Invalid edit session." });
    if (date < CLEAN_START_DATE) return res.status(409).json({ ok: false, error: "This editing session is from before the clean restart." });

    const reportKey = `${branch}__${date}__${shiftId}`, supabase = supabaseAdmin();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data: row, error } = await supabase.from("fueltech_reports").select("data,updated_at").eq("report_key", reportKey).maybeSingle();
      if (error) throw error;
      const report = row?.data || { branch, date, shiftId, confirmed: false }, meta = report.serverMeta || {}, lease = meta.editLease;
      const leaseActive = lease && Date.parse(lease.expiresAt || "") > Date.now();
      if (action !== "release" && leaseActive && lease.clientId !== clientId) {
        return res.status(409).json({ ok: false, conflict: true, error: `This report is already open${lease.actor ? ` by ${lease.actor}` : " on another device"}.`, editor: lease });
      }
      const editLease = action === "release" ? (lease?.clientId === clientId ? null : lease || null) : { clientId, actor: String(actor || "Cashier").trim() || "Cashier", expiresAt: new Date(Date.now() + LEASE_MS).toISOString() };
      const payload = { report_key: reportKey, branch, report_date: date, shift_id: shiftId, data: { ...report, serverMeta: { ...meta, version: Number(meta.version || 0), editLease } }, updated_at: new Date().toISOString() };
      const query = row
        ? supabase.from("fueltech_reports").update(payload).eq("report_key", reportKey).eq("updated_at", row.updated_at).select("data").maybeSingle()
        : supabase.from("fueltech_reports").insert(payload).select("data").maybeSingle();
      const { data: written, error: writeError } = await query;
      if (writeError?.code === "23505" || (!writeError && !written)) continue;
      if (writeError) throw writeError;
      return res.status(200).json({ ok: true, editor: editLease });
    }
    return res.status(409).json({ ok: false, conflict: true, error: "Another device opened this report first." });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Unable to manage edit session." });
  }
}
