const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");
const reports = fs.readFileSync(path.join(__dirname, "..", "api", "reports", "save.js"), "utf8");
const prices = fs.readFileSync(path.join(__dirname, "..", "api", "prices", "save.js"), "utf8");
const leases = fs.readFileSync(path.join(__dirname, "..", "api", "reports", "lease.js"), "utf8");

assert(app.includes('fueltech-report-offline-queue-v2'), "Clean restart should ignore the old device queue.");
assert(app.includes('MISSING_SHIFT_WARNING_START_DATE = "2026-07-29"'), "Missing-shift checks should include the global opening baseline date.");
assert(reports.includes('CLEAN_START_DATE = "2026-07-29"'), "Server should allow the global baseline but block older report uploads.");
assert(prices.includes('CLEAN_START_DATE = "2026-07-30"'), "Server should allow prices from the first reporting date and block older prices.");
assert(leases.includes('CLEAN_START_DATE = "2026-07-29"'), "Server should allow the global baseline lease but block older editing leases.");

console.log("Clean reset boundary check passed.");
