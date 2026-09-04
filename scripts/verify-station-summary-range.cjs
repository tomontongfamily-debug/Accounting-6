const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(app.includes("stationSummaryStartDate"), "Station Summary should have a From date state.");
assert(app.includes("stationSummaryEndDate"), "Station Summary should have a To date state.");
assert(app.includes("stationSummaryReports"), "Station Summary should collect reports from a date range.");
assert(app.includes("stationSummaryResult"), "Station Summary should summarize the selected station range.");
assert(app.includes("Station Summary From"), "Station Summary should show a From date input.");
assert(app.includes("Station Summary To"), "Station Summary should show a To date input.");
assert(app.includes("Reports Included"), "Station Summary should show how many submitted reports are included.");
assert(app.includes("Submitted reports only"), "Station Summary should explain that drafts are excluded.");
assert(app.includes("summarizeReports(stationSummaryReports)"), "Station Summary should use the normal summary formula.");

console.log("Station summary range check passed.");
