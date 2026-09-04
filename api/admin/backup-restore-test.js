import { createHash } from "node:crypto";
import { getRequestSession } from "../_shared/session.js";
import { supabaseAdmin } from "../_shared/supabase.js";

function checksum(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonical(reports, prices) {
  return {
    reports: [...reports].sort((a, b) => String(a.report_key).localeCompare(String(b.report_key))),
    prices: [...prices].sort((a, b) => `${a.branch}|${a.effective_date}|${a.coverage}|${a.shift_id}`.localeCompare(`${b.branch}|${b.effective_date}|${b.coverage}|${b.shift_id}`)),
  };
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

    const { data, error } = await supabaseAdmin()
      .from("fueltech_backups")
      .select("backup_date,report_count,payload")
      .order("backup_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data?.payload) {
      res.status(404).json({ ok: false, error: "No nightly backup is available to test yet." });
      return;
    }

    const reports = data.payload.reports;
    const prices = data.payload.price_book_snapshot;
    if (!Array.isArray(reports) || !Array.isArray(prices)) throw new Error("Backup payload is incomplete.");
    if (reports.some((row) => !row?.report_key || !row?.branch || !row?.report_date || !row?.shift_id || !row?.data)) throw new Error("Backup contains an invalid report record.");
    if (prices.some((row) => !row?.branch || !row?.effective_date || !row?.prices)) throw new Error("Backup contains an invalid price record.");

    const reportMap = new Map(reports.map((row) => [row.report_key, structuredClone(row)]));
    const priceMap = new Map(prices.map((row) => [`${row.branch}|${row.effective_date}|${row.coverage}|${row.shift_id}`, structuredClone(row)]));
    if (reportMap.size !== reports.length || priceMap.size !== prices.length) throw new Error("Backup contains duplicate record keys.");
    if (Number(data.report_count) !== reports.length) throw new Error("Backup report count does not match its payload.");

    const source = canonical(reports, prices);
    const restored = canonical([...reportMap.values()], [...priceMap.values()]);
    const sourceChecksum = checksum(source);
    const restoredChecksum = checksum(restored);
    if (sourceChecksum !== restoredChecksum) throw new Error("Restored backup checksum does not match the source backup.");

    res.status(200).json({
      ok: true,
      mode: "non-destructive-memory-restore",
      backupDate: data.backup_date,
      reportCount: reports.length,
      priceCount: prices.length,
      checksum: restoredChecksum,
      testedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Backup restoration test failed." });
  }
}
