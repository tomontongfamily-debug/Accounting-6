const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(source.includes("ConfirmReportDialog"), "Cashier should use an in-app report confirmation dialog.");
assert(source.includes("Submit this shift report?"), "Dialog should clearly ask for confirmation.");
assert(source.includes("Go Back"), "Dialog should offer a Go Back button.");
assert(source.includes("Confirm Report"), "Dialog should offer a Confirm Report button.");
assert(source.includes("reportReviewFlags(report, result)"), "Dialog should summarize the report review status.");
assert(!source.includes("showSubmitChecklist"), "Cashier should not show the old submit checklist.");

const dialogStart = source.indexOf("function ConfirmReportDialog");
assert(dialogStart >= 0, "Confirm report dialog should exist.");
const dialogEnd = source.indexOf("function CashierPage", dialogStart);
assert(dialogEnd > dialogStart, "Confirm report dialog should be before CashierPage.");
const dialogSource = source.slice(dialogStart, dialogEnd);
assert(!dialogSource.includes("Expected Cash"), "Cashier dialog should not show expected cash.");
assert(!dialogSource.includes("Bank Deposits"), "Cashier dialog should not show bank deposits.");
assert(!dialogSource.includes("title=\"Cash Variance\""), "Cashier dialog should not show a cash variance card.");
assert(!dialogSource.includes("peso(result.cashVariance)"), "Cashier dialog should not show cash variance amount.");
assert(!dialogSource.includes("High Cash Variance"), "Cashier dialog should not use warning wording.");

console.log("Cashier report confirmation check passed.");
