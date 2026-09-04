const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(app.includes('const GLOBAL_OPENING_DATE = "2026-07-29"'), "Every opening setup should represent July 29, 2026.");
assert(app.includes('const GLOBAL_OPENING_SHIFT_ID = "shift-3"'), "Every opening setup should represent Shift 3.");
assert(app.includes('const GLOBAL_REPORTING_START_DATE = "2026-07-30"'), "Normal reports should begin on July 30, 2026.");
assert(app.includes('{ id: "shift-1", label: "Shift 1 - 4:00 AM to 1:00 PM" }'), "Shift 1 should run 4:00 AM to 1:00 PM.");
assert(app.includes('{ id: "shift-2", label: "Shift 2 - 1:00 PM to 10:00 PM" }'), "Shift 2 should run 1:00 PM to 10:00 PM.");
assert(app.includes('{ id: "shift-3", label: "Shift 3 - 10:00 PM to 4:00 AM" }'), "Shift 3 should run 10:00 PM to 4:00 AM.");
assert(app.includes("if (hour < 4)"), "Automatic shift detection should treat before 4:00 AM as previous day's Shift 3.");
assert(app.includes("if (hour < 13)"), "Automatic shift detection should start Shift 2 at 1:00 PM.");
assert(app.includes("function branchReportingDate"), "Every station should calculate the first reporting day that is not fully submitted.");
assert(app.includes("reportCompleted(reports[reportKey(branch, date, shift.id)])"), "Every station should advance only after all three shifts are complete.");
assert(app.includes("cashierReportDateOverride || reportingDate"), "Every cashier should use the controlled reporting date.");
assert(app.includes('reopenedStartingReport?.shiftId || selectedShiftId'), "Cashier active shift should follow the selected shift unless a reopened opening setup locks it.");
assert(app.includes("openingDate={GLOBAL_OPENING_DATE}"), "Every station should keep the fixed opening date.");

const reports = {};
const key = (date, shift) => `Liloan__${date}__shift-${shift}`;
const reportingDate = () => ["2026-07-30", "2026-07-31"].find((date) => ![1, 2, 3].every((shift) => reports[key(date, shift)]?.confirmed));
assert.equal(reportingDate(), "2026-07-30");
reports[key("2026-07-30", 1)] = { confirmed: true };
reports[key("2026-07-30", 2)] = { confirmed: true };
assert.equal(reportingDate(), "2026-07-30", "The station must stay on July 30 while one shift is missing.");
reports[key("2026-07-30", 3)] = { confirmed: true };
assert.equal(reportingDate(), "2026-07-31", "The station should advance after all three shifts are confirmed.");

console.log("Global July 29 baseline and daily progression check passed.");
