const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const backupCron = fs.readFileSync(path.join(root, "api", "cron", "nightly-backup.js"), "utf8");
const healthCron = fs.readFileSync(path.join(root, "api", "cron", "daily-health-check.js"), "utf8");
const adminHealth = fs.readFileSync(path.join(root, "api", "admin", "system-health.js"), "utf8");
const healthShared = fs.readFileSync(path.join(root, "api", "_shared", "health.js"), "utf8");
const sql = fs.readFileSync(path.join(root, "supabase", "fueltech-live-security-hardening.sql"), "utf8");

assert(vercel.includes("/api/cron/nightly-backup"), "Nightly backup cron should remain configured.");
assert(vercel.includes("/api/cron/daily-health-check"), "Daily health check cron should be configured.");
assert(backupCron.includes("CRON_SECRET"), "Nightly backup cron should require CRON_SECRET.");
assert(healthCron.includes("CRON_SECRET"), "Daily health cron should require CRON_SECRET.");
assert(healthCron.includes("fueltech_system_health"), "Daily health cron should save system health.");
assert(adminHealth.includes('auth.session.role !== "Admin"'), "System health API should require admin.");
assert(healthShared.includes("pendingCashOnHand"), "Health check should include cash pending at the station before calculating variance.");
assert(healthShared.includes("midShiftPriceChanges"), "Health check should honor manager mid-shift price changes.");
assert(healthShared.includes("returnedCalibration"), "Health check should treat returned calibration consistently with the app.");
assert(app.includes("System Health"), "Admin should show system health.");
assert(app.includes("loadSystemHealth"), "Admin should load system health from the server.");
assert(sql.includes("create table if not exists public.fueltech_system_health"), "Supabase SQL should create system health table.");
assert(sql.includes("revoke select, insert, update, delete on public.fueltech_system_health"), "System health table should stay private.");

console.log("System health cron check passed.");
