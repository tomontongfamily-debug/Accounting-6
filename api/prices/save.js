import { BRANCHES, SHIFT_IDS, readBody, supabaseAdmin } from "../_shared/supabase.js";
import { canWriteBranch, getRequestSession } from "../_shared/session.js";

const PRODUCTS = ["Premium", "Regular", "Diesel"];
const CLEAN_START_DATE = "2026-07-30";

function validSellingPrices(prices) {
  return prices && PRODUCTS.every((product) => Number.isFinite(Number(prices[product])) && Number(prices[product]) >= 0);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const auth = getRequestSession(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, error: "Please log in again before saving prices." });
      return;
    }

    const { branch, date, coverage, shiftId, prices } = readBody(req);
    const normalizedShift = coverage === "Shift" ? shiftId : "daily";
    if (!BRANCHES.includes(branch) || !date || !["Daily", "Shift"].includes(coverage) || (coverage === "Shift" && !SHIFT_IDS.includes(shiftId))) {
      res.status(400).json({ ok: false, error: "Invalid price setup." });
      return;
    }
    if (date < CLEAN_START_DATE) {
      res.status(409).json({ ok: false, error: "This price is from before the clean restart and cannot be uploaded." });
      return;
    }

    if (auth.session.role !== "Manager" && auth.session.role !== "Admin") {
      res.status(403).json({ ok: false, error: "Only manager or admin login can save prices." });
      return;
    }

    if (!canWriteBranch(auth.session, branch)) {
      res.status(403).json({ ok: false, error: "This login cannot save this station." });
      return;
    }

    if (!validSellingPrices(prices)) {
      res.status(400).json({ ok: false, error: "Fuel prices must be valid non-negative numbers." });
      return;
    }

    let safePrices = prices;
    if (auth.session.role === "Manager") {
      const { data: existing, error: existingError } = await supabaseAdmin()
        .from("fueltech_price_book")
        .select("prices")
        .eq("branch", branch)
        .eq("effective_date", date)
        .eq("coverage", coverage)
        .eq("shift_id", normalizedShift)
        .maybeSingle();
      if (existingError) throw existingError;
      safePrices = { ...(existing?.prices || {}), ...Object.fromEntries(PRODUCTS.map((product) => [product, Number(prices[product])])) };
    }

    const { error } = await supabaseAdmin().from("fueltech_price_book").upsert({
      branch,
      effective_date: date,
      coverage,
      shift_id: normalizedShift,
      prices: safePrices,
      updated_at: new Date().toISOString(),
    }, { onConflict: "branch,effective_date,coverage,shift_id" });

    if (error) {
      res.status(500).json({ ok: false, error: error.message });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Unable to save prices." });
  }
}
