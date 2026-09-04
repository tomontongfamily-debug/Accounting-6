const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(
  source.includes("filter((item) => item?.confirmed)"),
  "Admin consolidated summary should only include confirmed reports.",
);
assert(
  source.includes("adminDepositReports") && source.includes("filter((item) => item?.confirmed)"),
  "Admin consolidated deposit verification should only include confirmed reports.",
);
assert(
  source.includes("Shows zero until submitted") && source.includes("Draft report. Counts after cashier submits."),
  "Admin selected report view should show zero/clear draft text until cashier submits.",
);
assert(
  source.includes("const stationResult = report.confirmed ? result : zeroStationResult"),
  "Admin selected report financial cards should show zero values until report.confirmed.",
);
assert(
  source.includes("reportsForDate(store.reports, date).filter((report) => report.confirmed)"),
  "Admin backup export should exclude draft reports.",
);

console.log("Admin draft privacy check passed.");
