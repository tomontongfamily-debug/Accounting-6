const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(app.includes("pump price is missing or zero"), "Cashier should see pump price missing warnings.");
assert(app.includes("pump price is missing"), "Pump price warnings should block cashier submit.");
assert(!app.includes("disabled={criticalWarnings.length > 0 || editingConflict}"), "Cashier submit button should not be disabled by warnings.");
assert(app.includes("disabled={reportCompleted(report) || editingConflict || isSubmittingReport}"), "Cashier submit should be disabled only after completion, during an edit conflict, or while saving.");
assert(app.includes("Submitting Report..."), "Cashier submit should show a clear saving state after confirmation.");

console.log("Cashier submit unblock check passed.");
