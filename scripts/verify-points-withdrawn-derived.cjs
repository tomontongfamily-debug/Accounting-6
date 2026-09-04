const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(app.includes("function pointsWithdrawnFromRedemptions"), "Points withdrawn should have one automatic formula.");
assert(app.includes("const pointsWithdrawn = pointsWithdrawnFromRedemptions(report);"), "Compute should derive points withdrawn from cash and fuel redemption.");
assert(!app.includes('patchReport(["root", "pointsWithdrawn"]'), "Cashier should not manually type points withdrawn.");
assert(app.includes("{peso(pointsWithdrawnFromRedemptions(report))}"), "Cashier should see automatic points withdrawn as pesos.");
assert(app.includes("Cash Redemption + Fuel Redemption"), "UI should explain the automatic points withdrawn source.");

const deductionLine = app.match(/const deductionTotal = .*;/)?.[0] || "";
assert(deductionLine.includes("countedDeductionEntries(report.deductions)"), "Expected cash should subtract counted deduction fields.");
assert(!deductionLine.includes("pointsWithdrawn"), "Expected cash should not subtract points withdrawn separately.");

assert(!app.includes("totalRedemption + result.pointsWithdrawn"), "Total redemption should not double-count points withdrawn.");
assert(!app.includes("+ n(report.pointsWithdrawn), 0)"), "Export totals should not use old manually typed points withdrawn.");

console.log("Points withdrawn derived check passed.");
