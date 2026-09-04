import { createClient } from "@supabase/supabase-js";
import { manilaDateOffset } from "../_shared/health.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://chqinknijqtixeenhtvu.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";

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
    if (!SUPABASE_KEY) {
      res.status(500).json({ ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY." });
      return;
    }

    const backupDate = req.query.date || manilaDateOffset(-1);
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const [{ data: reports, error: reportError }, { data: prices, error: priceError }] = await Promise.all([
      supabase
        .from("fueltech_reports")
        .select("report_key,branch,report_date,shift_id,data,updated_at")
        .eq("report_date", backupDate)
        .order("branch", { ascending: true })
        .order("shift_id", { ascending: true }),
      supabase
        .from("fueltech_price_book")
        .select("branch,effective_date,coverage,shift_id,prices,updated_at")
        .lte("effective_date", backupDate),
    ]);

    if (reportError) {
      res.status(500).json({ ok: false, error: reportError.message });
      return;
    }

    if (priceError) {
      res.status(500).json({ ok: false, error: priceError.message });
      return;
    }

    const payload = {
      backup_date: backupDate,
      generated_at: new Date().toISOString(),
      timezone: "Asia/Manila",
      reports: reports || [],
      price_book_snapshot: prices || [],
    };

    const backupRecord = {
      backup_date: backupDate,
      report_count: payload.reports.length,
      payload,
    };

    const { data: existingBackup, error: existingError } = await supabase
      .from("fueltech_backups")
      .select("backup_date")
      .eq("backup_date", backupDate)
      .limit(1);

    if (existingError) {
      const tableMissing = existingError.code === "PGRST205";
      res.status(tableMissing ? 200 : 500).json({
        ok: false,
        backupReady: false,
        error: existingError.message,
        hint: "Run supabase/fueltech-live-security-hardening.sql so public.fueltech_backups exists.",
      });
      return;
    }

    const saveQuery = existingBackup?.length
      ? supabase.from("fueltech_backups").update(backupRecord).eq("backup_date", backupDate)
      : supabase.from("fueltech_backups").insert(backupRecord);

    const { error: backupError } = await saveQuery;

    if (backupError) {
      const tableMissing = backupError.code === "PGRST205";
      res.status(tableMissing ? 200 : 500).json({
        ok: false,
        backupReady: false,
        error: backupError.message,
        hint: "Run supabase/fueltech-accounting-online.sql so public.fueltech_backups exists.",
      });
      return;
    }

    res.status(200).json({ ok: true, backupDate, reportCount: payload.reports.length });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Nightly backup failed." });
    return;
  }
}
