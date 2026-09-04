const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const save = fs.readFileSync(path.join(root, "api", "reports", "save.js"), "utf8");
const lease = fs.readFileSync(path.join(root, "api", "reports", "lease.js"), "utf8");

assert(app.includes("OFFLINE_QUEUE_KEY"));
assert(app.includes("mutationId"));
assert(app.includes("pendingSaveRef"));
assert(app.includes("requestReportLease"));
assert(app.includes("Fix This Reading"));
assert(app.includes("pumpConfigVersion"));
assert(save.includes("validateSubmission"));
assert(save.includes("validateContinuity"));
assert(save.includes("validateOpeningSetup"));
assert(save.includes("duplicateIgnored"));
assert(save.includes("lockedAt"));
assert(save.includes("atomicWrite"));
assert(lease.includes("LEASE_MS"));

console.log("Live report protection checks passed.");
