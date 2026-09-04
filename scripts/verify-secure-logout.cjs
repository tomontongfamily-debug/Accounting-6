const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");
const session = fs.readFileSync(path.join(__dirname, "..", "api", "_shared", "session.js"), "utf8");
const logout = fs.readFileSync(path.join(__dirname, "..", "api", "auth", "logout.js"), "utf8");

assert(app.includes('onClick={logout}>Log Out</button>'), "Cashier should have a visible Log Out button.");
assert(app.includes("window.sessionStorage.removeItem(CASHIER_SESSION_CACHE_KEY)"), "Logout should remove cached cashier access.");
assert(app.includes('action: "release"'), "Logout should release the active cashier edit lease.");
assert(!app.includes("removeLocalDraft(activeReport)"), "Logout must not erase an unfinished local draft.");
assert(session.includes("Max-Age=0; HttpOnly; Secure; SameSite=Strict"), "Logout cookie should expire immediately and retain secure flags.");
assert(logout.includes('res.setHeader("Set-Cookie", clearSessionCookie())'), "Logout endpoint should clear the server session cookie.");
assert(logout.includes('res.setHeader("Cache-Control", "no-store")'), "Logout response must not be cached.");

console.log("Secure cashier logout check passed.");
