const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const apiShared = fs.readFileSync(path.join(__dirname, "..", "api", "_shared", "supabase.js"), "utf8");
const sessionShared = fs.readFileSync(path.join(__dirname, "..", "api", "_shared", "session.js"), "utf8");
const reportSave = fs.readFileSync(path.join(__dirname, "..", "api", "reports", "save.js"), "utf8");
const storeLoad = fs.readFileSync(path.join(__dirname, "..", "api", "store", "load.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");
const sqlSource = fs.readFileSync(path.join(__dirname, "..", "supabase", "fueltech-accounting-online.sql"), "utf8");

assert(apiShared.includes("SUPABASE_SERVICE_ROLE_KEY"), "Server Supabase helper should use the service role key.");
assert(!apiShared.includes("VITE_SUPABASE_PUBLISHABLE_KEY"), "Server Supabase helper must not fall back to the public browser key.");
assert(apiShared.includes("Missing SUPABASE_SERVICE_ROLE_KEY"), "Server helper should fail closed when service role is missing.");
assert(sessionShared.includes("process.env.FUELTECH_SESSION_SECRET || \"\""), "Session signing should require the dedicated session secret.");
assert(!sessionShared.includes("process.env.FUELTECH_ADMIN_PIN ||"), "Session signing should not fall back to the admin PIN.");
assert(!sessionShared.includes("process.env.CRON_SECRET ||"), "Session signing should not fall back to the cron secret.");

assert(reportSave.includes("mergeReportForRole"), "Report save API should merge incoming reports by role.");
assert(reportSave.includes("session.role === \"Cashier\""), "Report save API should handle cashier saves explicitly.");
assert(reportSave.includes("session.role === \"Manager\""), "Report save API should handle manager saves explicitly.");
assert(reportSave.includes("deposits: existingReport.deposits || []"), "Cashier saves should preserve existing deposits.");
assert(reportSave.includes("midShiftPriceChanges: existingReport.midShiftPriceChanges || []"), "Cashier saves should preserve manager price-change setup.");
assert(reportSave.includes("incomingReport.pumpRows.length > 0 ? incomingReport.pumpRows : existingReport.pumpRows || []"), "Cashier saves must not replace existing pump rows with an empty edit-session payload.");
assert(reportSave.includes("deposits: incomingReport.deposits || []"), "Manager saves should be limited to deposit updates.");
assert(reportSave.includes("midShiftPriceChanges: incomingReport.midShiftPriceChanges || []"), "Manager saves should be limited to price-change setup.");
assert(reportSave.includes("return incomingReport;"), "Admin should retain full report save ability.");
assert(reportSave.includes("validateOpeningSetup"), "Server should validate that opening setup is the station's first completed report.");
assert(reportSave.includes("existingReport.baselineReport && existingReport.baselineConfirmed"), "Only a confirmed opening setup should be locked against cashier edits.");
assert(reportSave.includes("existingReport.confirmed || completedOpeningSetup"), "Server should lock submitted reports and completed opening setups.");
assert(reportSave.includes("Opening setup can only be confirmed as the station's first completed report."), "A cashier must not bypass shift continuity by forging an opening-setup flag.");

assert(storeLoad.includes("getRequestSession"), "Store load API should require a signed session.");
assert(storeLoad.includes("auth.session.role !== \"Admin\""), "Store load API should filter non-admin users to one branch.");
assert(!appSource.includes("createClient"), "Browser app should not create a direct Supabase client.");
assert(!appSource.includes("supabase."), "Browser app should not call Supabase directly.");
assert(!appSource.includes(".from(\"fueltech_reports\")"), "Browser app should not read reports directly from Supabase.");
assert(!appSource.includes(".from(\"fueltech_price_book\")"), "Browser app should not read prices directly from Supabase.");
assert(sqlSource.includes("revoke select, insert, update, delete on public.fueltech_reports"), "Supabase SQL should revoke direct report table access.");
assert(sqlSource.includes("drop policy if exists \"FuelTech can read reports\""), "Supabase SQL should drop public report read policy.");

console.log("Server role hardening check passed.");
