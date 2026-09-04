import { buildOwnerSmsSummary, formatOwnerSms, sendUniSms } from "../_shared/owner-sms.js";
import { manilaDateOffset } from "../_shared/health.js";
import { supabaseAdmin } from "../_shared/supabase.js";

function isMissingHealthTable(error) {
  return error?.code === "PGRST205"
    && /fueltech_system_health/i.test(error?.message || "");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
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
    const currentDate = req.query.date || manilaDateOffset(0);
    const sendDate = currentDate;
    const dryRun = req.query.dryRun === "1";
    const startSegment = Math.max(1, Number.parseInt(req.query.startSegment || "1", 10) || 1);
    const endSegment = Math.max(
      startSegment,
      Number.parseInt(req.query.endSegment || String(Number.MAX_SAFE_INTEGER), 10) || Number.MAX_SAFE_INTEGER,
    );
    const supabase = supabaseAdmin();
    const [reportResult, priceResult, healthResult] = await Promise.all([
      supabase
        .from("fueltech_reports")
        .select("report_key,branch,report_date,shift_id,data,updated_at")
        .eq("report_date", currentDate)
        .eq("shift_id", "shift-1"),
      supabase
        .from("fueltech_price_book")
        .select("branch,effective_date,coverage,shift_id,prices,updated_at")
        .lte("effective_date", currentDate),
      supabase
        .from("fueltech_system_health")
        .select("payload")
        .eq("check_date", currentDate)
        .maybeSingle(),
    ]);

    if (reportResult.error) throw reportResult.error;
    if (priceResult.error) throw priceResult.error;
    const healthTableMissing = isMissingHealthTable(healthResult.error);
    if (healthResult.error && !healthTableMissing) throw healthResult.error;

    const summary = buildOwnerSmsSummary({
      reportRows: reportResult.data || [],
      priceRows: priceResult.data || [],
      currentDate,
      shiftId: "shift-1",
    });
    const content = formatOwnerSms(summary, sendDate);
    if (dryRun) {
      res.status(200).json({ ok: true, dryRun: true, currentDate, content, length: content.length, summary });
      return;
    }

    const existingPayload = healthTableMissing ? {} : (healthResult.data?.payload || {});
    if (existingPayload.ownerSms?.status === "sent") {
      res.status(200).json({ ok: true, skipped: true, currentDate, reason: "Daily owner SMS was already sent." });
      return;
    }

    const sent = await sendUniSms({
      apiKey: process.env.UNISMS_API_KEY,
      recipients: String(process.env.OWNER_MOBILE_NUMBERS || process.env.OWNER_MOBILE_NUMBER || "").split(","),
      senderId: process.env.UNISMS_SENDER_ID || "Unisoft",
      content,
      startSegment,
      endSegment,
    });
    const ownerSms = {
      status: "sent",
      referenceId: sent.referenceId,
      providerStatus: sent.status,
      reportDate: currentDate,
      sentAt: new Date().toISOString(),
      contentLength: content.length,
      submittedReportCount: summary.submittedReportCount,
      recipientCount: sent.recipientCount,
    };
    if (!healthTableMissing) {
      const { error: saveError } = await supabase.from("fueltech_system_health").upsert({
        check_date: currentDate,
        payload: { ...existingPayload, ownerSms },
        updated_at: new Date().toISOString(),
      }, { onConflict: "check_date" });
      if (saveError) throw saveError;
    } else {
      console.warn("Daily owner SMS sent without dispatch log because fueltech_system_health is not installed.");
    }

    res.status(200).json({
      ok: true,
      currentDate,
      referenceId: sent.referenceId,
      providerStatus: sent.status,
      recipientCount: sent.recipientCount,
      segmentCount: sent.segmentCount || 1,
      dispatchLogged: !healthTableMissing,
    });
  } catch (error) {
    console.error("Daily owner SMS failed:", error.message || "Unknown error");
    res.status(500).json({ ok: false, error: error.message || "Daily owner SMS failed." });
  }
}
