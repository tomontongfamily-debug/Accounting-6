import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ownerCashTrendRows, ownerPeriodRange, ownerReportsForPeriod } from "../src/owner-period.js";

test("builds current-to-date owner ranges", () => {
  assert.deepEqual(ownerPeriodRange("Daily", "2026-07-28", "2026-07-21"), {
    start: "2026-07-28",
    end: "2026-07-28",
  });
  assert.deepEqual(ownerPeriodRange("Weekly", "2026-07-28", "2026-07-21"), {
    start: "2026-07-22",
    end: "2026-07-28",
  });
  assert.deepEqual(ownerPeriodRange("Monthly", "2026-07-28", "2026-07-21"), {
    start: "2026-07-01",
    end: "2026-07-28",
  });
  assert.deepEqual(ownerPeriodRange("Quarterly", "2026-07-28", "2026-07-21"), {
    start: "2026-07-01",
    end: "2026-07-28",
  });
  assert.deepEqual(ownerPeriodRange("Yearly", "2026-07-28", "2026-07-21"), {
    start: "2026-01-01",
    end: "2026-07-28",
  });
  assert.deepEqual(ownerPeriodRange("All-time", "2026-07-28", "2026-07-21"), {
    start: "2026-07-21",
    end: "2026-07-28",
  });
});

test("filters Shift to the selected shift while Daily includes every shift", () => {
  const reports = [
    { confirmed: true, date: "2026-07-28", shiftId: "shift-1" },
    { confirmed: true, date: "2026-07-28", shiftId: "shift-2" },
    { confirmed: false, date: "2026-07-28", shiftId: "shift-1" },
  ];
  const range = { start: "2026-07-28", end: "2026-07-28" };

  assert.equal(ownerReportsForPeriod(reports, range, "Shift", "shift-2").length, 1);
  assert.equal(ownerReportsForPeriod(reports, range, "Daily", "shift-2").length, 2);
});

test("builds complete chart periods even when some dates have no reports", () => {
  const reports = [
    { confirmed: true, date: "2026-07-22", shiftId: "shift-1", value: 220 },
    { confirmed: true, date: "2026-07-28", shiftId: "shift-1", value: 280 },
  ];
  const branches = ["Liloan"];
  const shifts = [{ id: "shift-1", shortLabel: "Shift 1" }];

  const monthly = ownerCashTrendRows(
    reports,
    "Monthly",
    { start: "2026-07-01", end: "2026-07-28" },
    (report) => report.value,
    branches,
    shifts,
  );
  assert.deepEqual(monthly.map(({ label, value }) => ({ label, value })), [
    { label: "Week 1", value: 0 },
    { label: "Week 2", value: 0 },
    { label: "Week 3", value: 0 },
    { label: "Week 4", value: 500 },
  ]);

  const yearly = ownerCashTrendRows(
    reports,
    "Yearly",
    { start: "2026-01-01", end: "2026-07-28" },
    (report) => report.value,
    branches,
    shifts,
  );
  assert.equal(yearly.length, 7);
  assert.deepEqual(yearly.map((row) => row.label), ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"]);
  assert.equal(yearly[0].value, 0);
  assert.equal(yearly[6].value, 500);
});

test("keeps a visible chart structure for every mobile performance period", () => {
  const branches = ["Liloan"];
  const shifts = [
    { id: "shift-1", shortLabel: "Shift 1" },
    { id: "shift-2", shortLabel: "Shift 2" },
    { id: "shift-3", shortLabel: "Shift 3" },
  ];
  const ranges = {
    Daily: { start: "2026-07-30", end: "2026-07-30" },
    Weekly: { start: "2026-07-24", end: "2026-07-30" },
    Monthly: { start: "2026-07-01", end: "2026-07-30" },
    Quarterly: { start: "2026-07-01", end: "2026-07-30" },
    Yearly: { start: "2026-01-01", end: "2026-07-30" },
    "All-time": { start: "2026-07-30", end: "2026-07-30" },
  };

  Object.entries(ranges).forEach(([period, range]) => {
    const rows = ownerCashTrendRows([], period, range, () => 0, branches, shifts);
    assert.ok(rows.length > 0, `${period} should retain visible zero-filled chart points.`);
  });
});

test("admin mobile offers Shiftly before Daily and filters the selected shift", () => {
  const source = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /MOBILE_PERFORMANCE_PERIODS = \["Shift", "Daily"/);
  assert.match(source, /option === "Shift" \? "Shiftly"/);
  assert.match(source, /period !== "Shift" \|\| item\.shiftId === shiftId/);
});
