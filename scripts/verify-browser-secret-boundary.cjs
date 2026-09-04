const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const auth = fs.readFileSync(path.join(root, "api", "auth", "verify.js"), "utf8");
const session = fs.readFileSync(path.join(root, "api", "_shared", "session.js"), "utf8");
const store = fs.readFileSync(path.join(root, "api", "store", "load.js"), "utf8");
const prices = fs.readFileSync(path.join(root, "api", "prices", "save.js"), "utf8");

assert(auth.includes("createSessionCookie"), "Login should place the signed session in a cookie.");
assert(auth.includes("LOGIN_LIMIT = 5"), "Login should limit repeated PIN attempts.");
assert(session.includes("HttpOnly; Secure; SameSite=Strict"), "Session cookie must be HttpOnly, Secure, and SameSite Strict.");
assert(app.includes('sessionToken !== "cookie"'), "Browser should not receive the signed session in JavaScript.");
assert(store.includes("PUBLIC_PRICE_FIELDS"), "Non-admin price responses should remove fuel costs.");
assert(store.includes("deposits: []"), "Cashier responses should remove bank deposits.");
assert(prices.includes('auth.session.role === "Manager"'), "Manager price writes should be sanitized server-side.");
assert(prices.includes("Object.fromEntries(PRODUCTS.map"), "Manager writes should allow only selling prices.");

console.log("Browser secret boundary check passed.");
