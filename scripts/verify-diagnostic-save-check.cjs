const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const source = fs.readFileSync(path.join(__dirname, "..", "api", "admin", "diagnostic-save-check.js"), "utf8");
const runner = fs.readFileSync(path.join(__dirname, "run-diagnostic-save-check.cjs"), "utf8");

assert(source.includes("auth.session.role !== \"Admin\""), "Diagnostic endpoint must require admin login.");
assert(source.includes("2030-01-01"), "Diagnostic endpoint must use future test dates.");
assert(source.includes("__fueltechDiagnostic"), "Diagnostic rows must be clearly marked.");
assert(source.includes("Cleanup stopped because a non-diagnostic report was found"), "Cleanup must refuse to delete non-diagnostic reports.");
assert(source.includes("Cleanup stopped because a non-diagnostic price row was found"), "Cleanup must refuse to delete non-diagnostic prices.");
assert(source.includes("reportRowsRemaining: 0"), "Endpoint should verify fake reports were deleted.");
assert(source.includes("priceRowsRemaining: 0"), "Endpoint should verify fake prices were deleted.");
assert(runner.includes("/api/admin/diagnostic-save-check"), "Runner should call the diagnostic endpoint.");
assert(runner.includes("/api/auth/verify"), "Runner should login through the normal admin API.");

console.log("Diagnostic save check safety test passed.");
