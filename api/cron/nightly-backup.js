import { createClient } from "@supabase/supabase-js";
import { manilaDateOffset } from "../_shared/health.js";
import { backupImmutable } from '../../pilot/backup.mjs';

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

    const pilotConfig=await supabase.from('fueltech_pilot_config').select('storage_version').eq('branch','Liloan').single();
    if(pilotConfig.error)return res.status(500).json({ok:false,error:'Pilot backup configuration could not be verified.'});
    const recoveryArchives=[];
    if(pilotConfig.data.storage_version===2){
      const heads=await supabase.from('fueltech_pilot_heads').select('mode,revision');
      if(heads.error)throw Error('Recovery revisions could not be verified.');
      for(const head of heads.data){
        const baseline=await supabase.from('fueltech_pilot_state_legacy').select('mode,revision,data,updated_at').eq('mode',head.mode).maybeSingle();
        if(baseline.error)throw Error('Recovery baseline could not be verified.');
        if(baseline.data)recoveryArchives.push(await backupImmutable(`journals/baselines/${head.mode}/${baseline.data.revision}.json`,Buffer.from(JSON.stringify({schemaVersion:2,baseline:baseline.data})),'application/json'));
        const checkpoint=await supabase.rpc('fueltech_pilot_checkpoint',{p_mode:head.mode});
        if(checkpoint.error)throw Error('Recovery checkpoint could not be verified.');
        // Bounded immutable chunks avoid building a second large journal in RAM.
        let cursor=0;
        for(;;){
          const page=await supabase.from('fueltech_pilot_journal').select('mode,revision,patch,created_at').eq('mode',head.mode).gt('revision',cursor).lte('revision',head.revision).gte('created_at',backupDate+'T00:00:00+08:00').order('revision').limit(100);
          if(page.error)throw Error('Recovery journal could not be verified.');
          if(!page.data.length)break;
          cursor=page.data.at(-1).revision;
          recoveryArchives.push(await backupImmutable(`journals/${backupDate}/${head.mode}/${cursor}.json`,Buffer.from(JSON.stringify({schemaVersion:2,entries:page.data})),'application/json'));
        }
      }
    }
    const pilotSnapshot=await supabase.from('fueltech_pilot_state').select('mode,revision,data,updated_at');
    if(pilotSnapshot.error) return res.status(500).json({ok:false,error:'Pilot state backup could not be verified.'});
    const payload = {
      backup_date: backupDate,
      generated_at: new Date().toISOString(),
      timezone: "Asia/Manila",
      reports: reports || [],
      price_book_snapshot: prices || [],
      pilot_state_snapshot: pilotSnapshot.data || [],
      recovery_journal_archives: recoveryArchives,
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

    const snapshot=Buffer.from(JSON.stringify({schemaVersion:1,...payload}));
    const offProject=await backupImmutable(`snapshots/${backupDate}/${Date.now()}.json`,snapshot,'application/json');
    res.status(200).json({ ok: true, backupDate, reportCount: payload.reports.length,offProjectBackup:offProject });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Nightly backup failed." });
    return;
  }
}
