import { timingSafeEqual } from "node:crypto";
import { createSessionCookie, createSessionToken, sessionTtlSeconds } from "../_shared/session.js";
import { normalizePinForComparison } from "../../src/pin-input.js";

const BRANCHES = ["Mabolo", "Arpili", "Liloan", "Pondol", "Barili", "Moalboal"];
const ROLES = ["Admin", "Approver", "Cashier", "Manager"];
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_LIMIT = 5;
const loginAttempts = globalThis.__fueltechLoginAttempts || new Map();
globalThis.__fueltechLoginAttempts = loginAttempts;

function readBody(req) {
  if (!req.body) return {};
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
}

function parsePinMap(value = "{}") {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function sameSecret(a = "", b = "") {
  const left = Buffer.from(normalizePinForComparison(a));
  const right = Buffer.from(normalizePinForComparison(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function expectedPin(role, branch) {
  if (role === "Admin") return process.env.FUELTECH_ADMIN_PIN || "";
  if (role === "Approver") return process.env.FUELTECH_APPROVER_PIN || "";
  const pins = parsePinMap(role === "Cashier" ? process.env.FUELTECH_CASHIER_PINS_JSON : process.env.FUELTECH_MANAGER_PINS_JSON);
  return pins[branch] || "";
}

function requestKey(req, role, branch) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return `${forwarded || req.socket?.remoteAddress || "unknown"}|${role}|${branch || "admin"}`;
}

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ ok: false });
    return;
  }

  try {
    const { role, branch, pin } = readBody(req);
    if (!ROLES.includes(role)) {
      res.status(200).json({ ok: false });
      return;
    }

    if (role !== "Admin" && role !== "Approver" && !BRANCHES.includes(branch)) {
      res.status(200).json({ ok: false });
      return;
    }

    const key = requestKey(req, role, branch);
    const now = Date.now();
    const attempt = loginAttempts.get(key);
    if (attempt && attempt.count >= LOGIN_LIMIT && now - attempt.startedAt < LOGIN_WINDOW_MS) {
      res.status(429).json({ ok: false, error: "Too many attempts. Wait 15 minutes before trying again." });
      return;
    }
    if (attempt && now - attempt.startedAt >= LOGIN_WINDOW_MS) loginAttempts.delete(key);

    const expected = expectedPin(role, branch);
    const ok = Boolean(expected && sameSecret(pin, expected));
    if (!ok) {
      const current = loginAttempts.get(key);
      loginAttempts.set(key, current ? { ...current, count: current.count + 1 } : { count: 1, startedAt: now });
      res.status(200).json({ ok: false });
      return;
    }

    loginAttempts.delete(key);
    const token = createSessionToken({ role, branch });
    if (!token) {
      res.status(500).json({ ok: false, error: "Secure session is not configured." });
      return;
    }
    res.setHeader("Set-Cookie", createSessionCookie(token, role));
    res.status(200).json({ ok: true, token: "cookie", expiresAt: Date.now() + sessionTtlSeconds(role) * 1000 });
  } catch {
    res.status(200).json({ ok: false });
  }
}
