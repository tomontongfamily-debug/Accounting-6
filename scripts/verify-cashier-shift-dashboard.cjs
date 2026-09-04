const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "src", "styles.css"), "utf8");

assert(app.includes("function CashierShiftDashboard"), "Cashier should have a three-shift dashboard.");
assert(app.includes("cashierInitialLoadPending"), "Cashier should not see false missing statuses before online reports finish loading.");
assert(app.includes("Loading Saved Reports"), "Cashier should see a clear initial loading state.");
assert(app.includes("SHIFT_OPTIONS.map"), "Dashboard should use all configured shifts.");
assert(app.includes('reportCompleted(report) ? "submitted" : hasMeaningfulDraftEntries(report) ? "draft" : "missing"'), "Completed opening setups should be submitted while empty placeholders remain Not started.");
assert(app.includes("setCashierReportOpen(true)"), "Pressing a shift should open its report.");
assert(app.includes("Back to Shifts"), "Cashier should be able to return to the shift dashboard.");
assert(app.includes("Opening Setup"), "Opening setup should have its own dashboard card.");
assert(app.includes("disabled={!openingComplete}"), "Shift cards should wait until opening setup is complete.");
assert(app.includes("Request Date Correction"), "Date correction request should remain available on the cashier dashboard.");
assert(app.includes("Send Request to Admin"), "Cashier should still be able to send the correction request to admin.");
assert(app.includes("onOpenOpening(openingDate, openingShiftId)"), "Opening setup should open its exact configured baseline shift.");
assert(app.includes("report?.baselineConfirmed === true"), "Opening setup should be complete only after explicit confirmation.");
assert(app.includes("function reportCompleted(report)"), "Opening setup and submitted reports should share one completion rule.");
assert(app.includes("function openingSetupCompleted(report)"), "Normal shifts with carried opening readings must not be mistaken for completed opening setup reports.");
assert(app.includes("report?.baselineReport === true"), "Only an actual opening-setup report should count as completed before submission.");
assert(app.includes("!openingSetupCompleted(report)"), "A completed opening setup must not reopen itself.");
assert(app.includes("shifts.filter(({ report }) => reportCompleted(report)).length"), "Opening setup should count toward the submitted shift total.");
assert(app.includes('disabled={reportCompleted(report)}'), "A completed opening setup should be locked against accidental edits.");
assert(app.includes("const openingSetupMode = Boolean(report.baselineMissing || report.baselineReport)"), "Opening setup should use an isolated cashier mode.");
assert(app.includes('!openingSetupMode && <Section title="Official Pump Reading Register">'), "Opening setup must not show the normal shift pump register.");
assert(app.includes('!openingSetupMode && <div className="cashier-wizard-actions">'), "Opening setup must not expose normal shift navigation.");
assert(!app.includes("hasRecordedStartingBaseline"), "Matching legacy readings must not falsely complete opening setup.");
assert(app.includes("These become Previous Shift Closing"), "Opening setup should explain the fresh-shift starting baseline.");
assert(app.includes("reportCompleted(report) || report.baselineMissing"), "The completed opening setup should not demand an earlier shift.");
assert(!app.includes('className="cashier-correction-panel"'), "Date correction should not appear inside the report wizard.");
assert(app.includes('{role === "Cashier" && (cashierInitialLoadPending'), "Cashier should use the loading/dashboard/report flow instead of the old dropdown.");
assert(app.includes('role !== "Cashier" || !cashierReportOpen'), "Dashboard-only viewing should not reserve a shift editing lease.");
assert(css.includes(".cashier-shift-grid"), "Three-shift dashboard should be styled.");
assert(css.includes(".cashier-opening-card"), "Opening setup card should be styled.");
assert(css.includes(".cashier-dashboard-correction"), "Dashboard data correction request should be styled.");

const reportCompleted = (report) => Boolean(report?.confirmed || (
  (report?.baselineConfirmed === true || report?.baseline_confirmed === true)
  && report?.baselineReport === true
));
assert.equal(reportCompleted({ baselineConfirmed: true, baselineReport: false }), false, "A normal shift with carried opening readings must remain editable.");
assert.equal(reportCompleted({ baselineConfirmed: true, baselineReport: true }), true, "The actual confirmed opening setup should be complete.");
assert.equal(reportCompleted({ confirmed: true, baselineConfirmed: true, baselineReport: false }), true, "A submitted normal shift should be complete.");

console.log("Cashier three-shift dashboard check passed.");
