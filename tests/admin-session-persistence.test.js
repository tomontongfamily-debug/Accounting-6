import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  createSessionCookie,
  createSessionToken,
  sessionTtlSeconds,
  verifySessionToken,
} from "../api/_shared/session.js";

test("admin sessions last ten hours without changing other role lifetimes", () => {
  assert.equal(sessionTtlSeconds("Admin"), 10 * 60 * 60);
  assert.equal(sessionTtlSeconds("Cashier"), 12 * 60 * 60);
  assert.equal(sessionTtlSeconds("Manager"), 12 * 60 * 60);
  assert.equal(sessionTtlSeconds("Approver"), 12 * 60 * 60);
  assert.match(createSessionCookie("token", "Admin"), /Max-Age=36000/);
  assert.match(createSessionCookie("token", "Cashier"), /Max-Age=43200/);
});

test("new admin session tokens expire ten hours after login", () => {
  const previousSecret = process.env.FUELTECH_SESSION_SECRET;
  process.env.FUELTECH_SESSION_SECRET = "admin-session-persistence-test";

  try {
    const before = Math.floor(Date.now() / 1000);
    const result = verifySessionToken(createSessionToken({ role: "Admin", branch: "" }));
    assert.equal(result.ok, true);
    assert.ok(result.session.exp >= before + 36_000);
    assert.ok(result.session.exp <= before + 36_001);
  } finally {
    if (previousSecret === undefined) delete process.env.FUELTECH_SESSION_SECRET;
    else process.env.FUELTECH_SESSION_SECRET = previousSecret;
  }
});

test("admin refresh restores the secure cookie session and schedules expiry logout", () => {
  const source = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /restoreAdminLoginSession\(\)/);
  assert.match(source, /setSessionToken\("cookie"\)/);
  assert.match(source, /window\.setTimeout\(logout, remaining\)/);
});
