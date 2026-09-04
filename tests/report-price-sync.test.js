import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { applyEffectivePricing } from "../src/report-price-sync.js";

test("updates report pricing without changing report entries", () => {
  const report = { cashierName: "Ana", pumpRows: [{ closing: 123 }], prices: { Premium: 70 } };
  const updated = applyEffectivePricing(report, {
    prices: { Premium: 75.2, Regular: 74.2, Diesel: 72.4 },
    pricingCoverage: "Shift",
    pricingEffectiveDate: "2026-08-17",
    pricingShiftId: "shift-2",
  });

  assert.equal(updated.prices.Premium, 75.2);
  assert.equal(updated.pricingShiftId, "shift-2");
  assert.equal(updated.cashierName, "Ana");
  assert.deepEqual(updated.pumpRows, report.pumpRows);
});

test("manager confirmation uses the selected historical date and shift", () => {
  const source = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const confirmation = source.slice(source.indexOf("function confirmDailyPrices()"), source.indexOf("async function unlock()"));
  assert.match(confirmation, /selectedDate/);
  assert.match(confirmation, /pricingShiftId/);
  assert.doesNotMatch(confirmation, /activeDate|activeShiftId|saveReport/);
});
