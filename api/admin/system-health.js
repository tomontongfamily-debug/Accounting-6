import { getRequestSession } from "../_shared/session.js";
import { supabaseAdmin } from "../_shared/supabase.js";

function tableMissing(error) {
  return error?.code === "PGRST205" || /schema cache|does not exist|Could not find/i.test(error?.message || "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const auth = getRequestSession(req);
    if (!auth.ok || auth.session.role !== "Admin") {
      res.status(401).json({ ok: false, error: "Admin login required." });
      return;
    }

    const supabase = supabaseAdmin();
    const [backupResult, healthResult] = await Promise.all([
      supabase
        .from("fueltech_backups")
        .select("backup_date,report_count,payload,created_at")
        .order("backup_date", { ascending: false })
        .limit(1),
      supabase
        .from("fueltech_system_health")
        .select("check_date,payload,missing_reports,missing_deposits,pending_deposits,cash_variance,updated_at")
        .neq("check_date", "1900-01-01")
        .order("check_date", { ascending: false })
        .limit(1),
    ]);

    const backupReady = !backupResult.error;
    const healthReady = !healthResult.error;

    if (backupResult.error && !tableMissing(backupResult.error)) {
      res.status(500).json({ ok: false, error: backupResult.error.message });
      return;
    }

    if (healthResult.error && !tableMissing(healthResult.error)) {
      res.status(500).json({ ok: false, error: healthResult.error.message });
      return;
    }

    res.status(200).json({
      ok: true,
      backupReady,
      healthReady,
      latestBackup: backupReady ? backupResult.data?.[0] || null : null,
      latestHealth: healthReady ? healthResult.data?.[0] || null : null,
      setupNeeded: !backupReady || !healthReady,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Unable to load system health." });
  }
}
