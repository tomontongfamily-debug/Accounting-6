import { getRequestSession } from "../_shared/session.js";

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || "https://chqinknijqtixeenhtvu.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || "sb_publishable_ftsaR9cx1hPtAERB9SO-PA_9nsbSwrq";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const auth = getRequestSession(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, error: "Please log in again before connecting live updates." });
    return;
  }

  res.status(200).json({
    ok: true,
    enabled: true,
    url: SUPABASE_URL,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
  });
}
