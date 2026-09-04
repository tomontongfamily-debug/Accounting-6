import test from "node:test";
import assert from "node:assert/strict";
import { blockingPumpReadings, negativePumpReadings } from "../src/pump-reading-warnings.js";

test("warns when an entered closing reading is below its opening reading", () => {
  const warnings = negativePumpReadings({
    pumpRows: [{
      id: "pump-3-premium",
      pump: "Pump 3",
      nozzle: "Premium",
      product: "Premium",
      opening: 207790.2,
      closing: 20806.91,
      closingEntered: true,
    }],
  });

  assert.deepEqual(warnings, [{
    rowId: "pump-3-premium",
    pump: "Pump 3",
    nozzle: "Premium",
    product: "Premium",
    opening: 207790.2,
    closing: 20806.91,
    liters: -186983.29,
    variance: -186983.29,
    kind: "negative",
    maximumLiters: 1500,
  }]);
});

test("blocks more than 1,500 liters and identifies the exact pump and product", () => {
  const warnings = blockingPumpReadings({
    pumpRows: [{
      id: "pump-2-diesel",
      pump: "Pump 2",
      nozzle: "Diesel",
      product: "Diesel",
      opening: 10000,
      closing: 11500.01,
      closingEntered: true,
    }],
  });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, "high");
  assert.equal(warnings[0].rowId, "pump-2-diesel");
  assert.equal(warnings[0].product, "Diesel");
  assert.equal(Number(warnings[0].liters.toFixed(2)), 1500.01);
});

test("allows equal, exactly 1,500 liters, and untouched ghost-zero readings", () => {
  const warnings = blockingPumpReadings({
    pumpRows: [
      { id: "equal", opening: 100, closing: 100, closingEntered: true },
      { id: "maximum", opening: 100, closing: 1600, closingEntered: true },
      { id: "untouched", opening: 100, closing: 0, closingEntered: false },
    ],
  });

  assert.deepEqual(warnings, []);
});
