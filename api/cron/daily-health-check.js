import { buildDailyHealth, manilaDateOffset } from "../_shared/health.js";
import { supabaseAdmin } from "../_shared/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const checkDate = req.query.date || manilaDateOffset(-1);
    const supabase = supabaseAdmin();
    const { data: reportRows, error: reportError } = await supabase
      .from("fueltech_reports")
      .select("report_key,data")
      .eq("report_date", checkDate);

    if (reportError) {
      res.status(500).json({ ok: false, error: reportError.message });
      return;
    }

    const payload = buildDailyHealth({ reportRows: reportRows || [], date: checkDate });
    const { error: healthError } = await supabase.from("fueltech_system_health").upsert({
      check_date: checkDate,
      payload,
      missing_reports: payload.missing,
      missing_deposits: payload.depositMissing,
      pending_deposits: payload.depositPending,
      cash_variance: payload.cashVariance,
      updated_at: new Date().toISOString(),
    }, { onConflict: "check_date" });

    if (healthError) {
      const tableMissing = healthError.code === "PGRST205" || /fueltech_system_health/i.test(healthError.message || "");
      res.status(tableMissing ? 200 : 500).json({
        ok: false,
        healthReady: false,
        error: healthError.message,
        hint: "Run supabase/fueltech-live-security-hardening.sql so public.fueltech_system_health exists.",
      });
      return;
    }

    res.status(200).json({ ok: true, checkDate, summary: payload });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Daily health check failed." });
  }
}
