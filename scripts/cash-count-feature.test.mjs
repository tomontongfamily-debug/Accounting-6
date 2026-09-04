import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const healthSource = readFileSync(new URL("../api/_shared/health.js", import.meta.url), "utf8");

test("cashier report supports an end-of-shift actual cash count separate from expected cash", () => {
  assert.match(appSource, /actualCashCounted:\s*""/);
  assert.match(appSource, /End-of-Shift Cash Count/);
  assert.match(appSource, /Actual Cash Difference/);

  const cashierPage = appSource.slice(appSource.indexOf("function CashierPage"), appSource.indexOf("function MidShiftPriceChangeSection"));
  assert.doesNotMatch(cashierPage, /Card title="Expected Cash On Hand"/);
  assert.doesNotMatch(cashierPage, /Card title="Actual Cash Difference"/);
  assert.match(appSource, /actualCashDifference/);
});

test("calibration cash is removed from deductions and ignored by totals", () => {
  assert.doesNotMatch(appSource, /calibrationCash/);
  assert.doesNotMatch(healthSource, /calibrationCash/);
});
