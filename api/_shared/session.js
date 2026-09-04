import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60;
const ADMIN_SESSION_TTL_SECONDS = 10 * 60 * 60;
const SESSION_COOKIE = "__Host-fueltech_session";

function sessionSecret() {
  return process.env.FUELTECH_SESSION_SECRET || "";
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payload) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function sameValue(left = "", right = "") {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createSessionToken({ role, branch }) {
  const secret = sessionSecret();
  if (!secret) return "";

  const payload = base64Url(JSON.stringify({
    role,
    branch: role === "Admin" || role === "Approver" ? "" : branch,
    exp: Math.floor(Date.now() / 1000) + sessionTtlSeconds(role),
  }));
  return `${payload}.${signPayload(payload)}`;
}

export function sessionTtlSeconds(role) {
  return role === "Admin" ? ADMIN_SESSION_TTL_SECONDS : DEFAULT_SESSION_TTL_SECONDS;
}

export function createSessionCookie(token, role) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${sessionTtlSeconds(role)}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function verifySessionToken(token = "") {
  const secret = sessionSecret();
  if (!secret || !token.includes(".")) return { ok: false };

  const [payload, signature] = token.split(".");
  if (!payload || !signature || !sameValue(signature, signPayload(payload))) return { ok: false };

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) return { ok: false };
    return { ok: true, session };
  } catch {
    return { ok: false };
  }
}

export function getRequestSession(req) {
  const headerToken = req.headers["x-fueltech-session"] || "";
  const cookieHeader = Array.isArray(req.headers.cookie) ? req.headers.cookie[0] : req.headers.cookie || "";
  const cookieToken = cookieHeader.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) || "";
  const token = headerToken || cookieToken;
  return verifySessionToken(Array.isArray(token) ? token[0] : token);
}

export function canWriteBranch(session, branch) {
  if (session?.role === "Admin") return true;
  return Boolean(session?.branch && session.branch === branch);
}
