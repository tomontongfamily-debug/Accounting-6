import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const appSource = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const saveSource = fs.readFileSync(new URL("../api/reports/save.js", import.meta.url), "utf8");

test("Mabolo and Liloan use the July 29 opening and July 30 reporting start", () => {
  assert.match(appSource, /GLOBAL_OPENING_DATE = "2026-07-29"/);
  assert.match(appSource, /GLOBAL_OPENING_SHIFT_ID = "shift-3"/);
  assert.match(appSource, /GLOBAL_REPORTING_START_DATE = "2026-07-30"/);
});

test("Mabolo and Liloan reject stale device drafts after the rewind", () => {
  for (const branch of ["Mabolo", "Liloan"]) {
    const expected = `${branch}: "2026-07-31-rewind-to-july-30-1"`;
    assert.equal(appSource.includes(expected), true);
    assert.equal(saveSource.includes(expected), true);
  }
});

test("reporting advances only after all three shifts are complete", () => {
  assert.match(
    appSource,
    /SHIFT_OPTIONS\.every\(\(shift\) => reportCompleted\(reports\[reportKey\(branch, date, shift\.id\)\]\)\)/
  );
  assert.match(appSource, /if \(!complete\) return date/);
  assert.match(appSource, /date = dateOffset\(date, 1\)/);
});
