const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(source.includes("function depositHealthRows"), "Admin should calculate deposit health rows.");
assert(source.includes("Deposit Health Summary"), "Admin should show a deposit health summary.");
assert(source.includes("Deposit Missing"), "Deposit health should show missing deposits.");
assert(source.includes("Deposit Saved"), "Deposit health should show saved deposits.");
assert(source.includes("Deposit Pending"), "Deposit health should show pending deposits.");

assert(source.includes("function stationRankingRows"), "Admin should calculate station ranking rows.");
assert(source.includes('const RANKING_RANGE_OPTIONS = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly", "All-time"];'), "Admin ranking should offer daily, weekly, monthly, quarterly, yearly, and all-time ranges.");
assert(source.includes("function rankingReportsForRange"), "Admin ranking should filter reports by selected ranking range.");
assert(source.includes('title="Station Ranking"'), "Admin should show station ranking.");
assert(!source.includes("Weekly Station Ranking"), "Admin ranking should not be fixed to weekly only.");
assert(source.includes("Liters Sold"), "Station ranking should include liters sold.");
assert(source.includes("Expected Cash"), "Station ranking should include expected cash.");
assert(source.includes("Deductions"), "Station ranking should include deductions.");
assert(!source.includes('headers={["Rank", "Station", "Submitted", "Check Required", "Deposit Missing", "Net Cash Flow"]}'), "Station ranking should not use the old warning-based columns.");

assert(source.includes("ConfirmReportDialog"), "Cashier should use a simple report confirmation dialog.");
assert(source.includes("Confirm Report"), "Cashier confirmation should use a Confirm Report action.");
assert(!source.includes("SubmitChecklistDialog"), "Cashier should not use the old before-submit checklist dialog.");
assert(!source.includes("Pump readings done"), "Old checklist text should be removed.");
assert(!source.includes("Continue Submit"), "Old checklist continue action should be removed.");

console.log("Deposit health, station ranking, and simplified submit confirmation check passed.");
