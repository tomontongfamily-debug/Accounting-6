const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(app.includes('if (openingSetupCompleted(report)) return { label: "Submitted", tone: "green", detail: "Opening Setup" }'), "Station Health should count only the actual opening setup as a submitted shift.");
assert(app.includes('if (!report.confirmed && !hasMeaningfulDraftEntries(report)) return { label: "Missing", tone: "red" }'), "Empty edit-session rows should show as Missing instead of Draft.");

assert(app.includes('const HEALTH_BRANCH_OPTIONS = ["All Stations", ...BRANCHES];'), "Admin health should offer all stations plus station picker.");
assert(app.includes("filteredHealthRows"), "Admin desktop station health should use filtered health rows.");
assert(app.includes("filteredDepositRows"), "Admin desktop deposit health should use filtered deposit rows.");
assert(app.includes("setHealthBranch"), "Admin health filter should have a station setter.");
assert(app.includes("Report Scope"), "System Health should show the selected reporting scope.");
assert(app.includes('<Field label="From Date"><TextInput type="date" value={healthStartDate}'), "System Health should show from-date picker.");
assert(app.includes('<Field label="To Date"><TextInput type="date" value={healthEndDate}'), "System Health should show to-date picker.");
assert(app.includes('<Field label="Station"><SelectInput value={healthBranch}'), "Station Health Summary should show station picker.");
assert(app.includes("filteredHealthCounts.Submitted"), "Station Health Summary cards should use filtered counts.");
assert(app.includes("filteredDepositCounts"), "Deposit Health Summary cards should use filtered counts.");

assert(app.includes("litersSold"), "Station ranking should include liters sold.");
assert(app.includes("expectedCash"), "Station ranking should include expected cash.");
assert(app.includes("deductions"), "Station ranking should include deductions.");
assert(app.includes("RANKING_RANGE_OPTIONS"), "Station ranking should have range options.");
assert(app.includes("rankingRange"), "Station ranking should use a selected range.");
assert(app.includes('headers={["Rank", "Station", "Submitted", "Liters Sold", "Expected Cash", "Deductions"]}'), "Ranking table should use the new useful columns.");
assert(!app.includes('headers={["Rank", "Station", "Submitted", "Check Required", "Deposit Missing", "Net Cash Flow"]}'), "Ranking table should not use old columns.");

const cashierSection = app.slice(app.indexOf("function CashierPage"), app.indexOf("function ManagerPage"));
const managerSection = app.slice(app.indexOf("function ManagerPage"), app.indexOf("function MobileAdminMetric"));
assert(!cashierSection.includes("HEALTH_BRANCH_OPTIONS"), "Cashier UI must not be touched by admin health filters.");
assert(!managerSection.includes("HEALTH_BRANCH_OPTIONS"), "Manager UI must not be touched by admin health filters.");

console.log("Admin health filters and ranking columns check passed.");
