import { createClient } from "@supabase/supabase-js";

export const BRANCHES = ["Mabolo", "Arpili", "Liloan", "Pondol", "Barili", "Moalboal"];
export const SHIFT_IDS = ["shift-1", "shift-2", "shift-3"];

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://chqinknijqtixeenhtvu.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";

export function supabaseAdmin() {
  if (!SUPABASE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

export function readBody(req) {
  if (!req.body) return {};
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
