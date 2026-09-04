import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyHealth } from "../api/_shared/health.js";
import { isMaboloPreOpeningSlot } from "../src/opening-health.js";

test("Mabolo shifts before its July 29 Shift 3 opening setup are not required", () => {
  assert.equal(isMaboloPreOpeningSlot("Mabolo", "2026-07-29", "shift-1"), true);
  assert.equal(isMaboloPreOpeningSlot("Mabolo", "2026-07-29", "shift-2"), true);
  assert.equal(isMaboloPreOpeningSlot("Mabolo", "2026-07-29", "shift-3"), false);
});

test("Mabolo opening day health does not count pre-opening shifts as missing", () => {
  const health = buildDailyHealth({
    date: "2026-07-29",
    reportRows: [{
      report_key: "Mabolo__2026-07-29__shift-3",
      data: { branch: "Mabolo", date: "2026-07-29", shiftId: "shift-3", baselineReport: true, baselineConfirmed: true },
    }],
  });
  const mabolo = health.stations.find((station) => station.branch === "Mabolo");

  assert.deepEqual(mabolo.shifts.map((shift) => shift.status), ["Not Required", "Not Required", "Submitted"]);
  assert.deepEqual(mabolo.shifts.map((shift) => shift.depositStatus), ["Not Required", "Not Required", "Not Required"]);
  assert.equal(mabolo.missing, 0);
});

test("Mabolo reports after opening day are still required", () => {
  const health = buildDailyHealth({ date: "2026-07-30", reportRows: [] });
  const mabolo = health.stations.find((station) => station.branch === "Mabolo");

  assert.deepEqual(mabolo.shifts.map((shift) => shift.status), ["Missing", "Missing", "Missing"]);
});
