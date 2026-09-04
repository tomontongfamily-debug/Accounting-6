import { supabaseAdmin } from "../_shared/supabase.js";
import { getRequestSession } from "../_shared/session.js";

const PUBLIC_PRICE_FIELDS = new Set(["Premium", "Regular", "Diesel", "confirmed", "confirmedAt"]);

function pricesForRole(prices, role) {
  if (role === "Admin") return prices || {};
  return Object.fromEntries(Object.entries(prices || {}).filter(([key]) => PUBLIC_PRICE_FIELDS.has(key)));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const auth = getRequestSession(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: "Please log in again before loading prices." });

    const supabase = supabaseAdmin();
    const query = supabase
      .from("fueltech_price_book")
      .select("branch,effective_date,coverage,shift_id,prices,updated_at");
    if (auth.session.role !== "Admin") query.eq("branch", auth.session.branch);

    const { data, error } = await query;
    if (error) throw error;
    return res.status(200).json({
      ok: true,
      priceRows: (data || []).map((row) => ({ ...row, prices: pricesForRole(row.prices, auth.session.role) })),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Unable to load manager prices." });
  }
}
