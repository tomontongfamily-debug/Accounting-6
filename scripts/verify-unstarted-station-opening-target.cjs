const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(
  app.includes("openingDate={GLOBAL_OPENING_DATE}"),
  "Every station must target the fixed global Opening Setup date.",
);
assert(
  app.includes("openingShiftId={GLOBAL_OPENING_SHIFT_ID}"),
  "Every station must use the fixed global Opening Setup shift.",
);
assert(
  app.includes('const openingComplete = Object.values(reports).some((report) => report?.branch === branch && openingSetupCompleted(report));'),
  "The previous-day target must apply only until that station has completed Opening Setup.",
);
assert(
  app.includes('const GLOBAL_OPENING_DATE = "2026-07-29"')
    && app.includes('const GLOBAL_OPENING_SHIFT_ID = "shift-3"'),
  "The global opening target must be July 29 Shift 3.",
);

function dateOffset(date, days) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + days);
  return [
    next.getFullYear(),
    String(next.getMonth() + 1).padStart(2, "0"),
    String(next.getDate()).padStart(2, "0"),
  ].join("-");
}

assert.equal(dateOffset("2026-08-01", -1), "2026-07-31", "The previous-day rule must work across months.");

console.log("Global July 29 Shift 3 opening target passed.");
