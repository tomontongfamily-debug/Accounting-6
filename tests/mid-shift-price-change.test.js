import assert from "node:assert/strict";
import test from "node:test";
import {
  addMidShiftChange,
  ensureMidShiftBasePrices,
  midShiftBasePrice,
  midShiftPumpKey,
  midShiftReadingValue,
  patchMidShiftChange,
  patchMidShiftReading,
  pricesAfterMidShift,
  reportStartingPrice,
  removeMidShiftChange,
} from "../src/mid-shift-price-change.js";

const report = {
  branch: "Pondol",
  date: "2026-07-31",
  shiftId: "shift-1",
  prices: { Premium: 74.5, Regular: 73.5, Diesel: 70.25 },
  midShiftPriceChanges: [{
    id: "change-1",
    product: "Premium",
    effectiveTime: "",
    newPrice: "",
    readings: {},
  }],
};

test("keeps earlier pump readings while entering the next reading", () => {
  const firstRow = { id: "temporary-1", pump: "Pump 1", nozzle: "Premium", product: "Premium" };
  const secondRow = { id: "temporary-2", pump: "Pump 2", nozzle: "Premium", product: "Premium" };
  const first = patchMidShiftReading(report, "change-1", midShiftPumpKey(firstRow), "101.25");
  const second = patchMidShiftReading(first, "change-1", midShiftPumpKey(secondRow), "202.50");

  assert.deepEqual(second.midShiftPriceChanges[0].readings, {
    "Pump 1|Premium|Premium": "101.25",
    "Pump 2|Premium|Premium": "202.50",
  });
});

test("editing price details does not remove entered readings", () => {
  const row = { id: "temporary-1", pump: "Pump 1", nozzle: "Premium", product: "Premium" };
  const withReading = patchMidShiftReading(report, "change-1", midShiftPumpKey(row), "101.25");
  const withTime = patchMidShiftChange(withReading, "change-1", "effectiveTime", "14:30");
  const withPrice = patchMidShiftChange(withTime, "change-1", "newPrice", "75.20");

  assert.equal(midShiftReadingValue(withPrice.midShiftPriceChanges[0], row), "101.25");
  assert.equal(withPrice.midShiftPriceChanges[0].effectiveTime, "14:30");
  assert.equal(withPrice.midShiftPriceChanges[0].newPrice, "75.20");
  assert.equal(withPrice.midShiftPriceChanges[0].confirmedAt, "");
});

test("reading remains attached when a temporary pump row ID changes after save", () => {
  const beforeSave = { id: "old-random-id", pump: "Pump 1", nozzle: "Premium", product: "Premium" };
  const afterSave = { id: "new-random-id", pump: "Pump 1", nozzle: "Premium", product: "Premium" };
  const updated = patchMidShiftReading(report, "change-1", midShiftPumpKey(beforeSave), "12345.67");

  assert.equal(midShiftReadingValue(updated.midShiftPriceChanges[0], afterSave), "12345.67");
});

test("historical readings stored by row ID remain readable", () => {
  const row = { id: "legacy-row-id", pump: "Pump 1", nozzle: "Premium", product: "Premium" };
  const legacyChange = { readings: { "legacy-row-id": "321.50" } };

  assert.equal(midShiftReadingValue(legacyChange, row), "321.50");
});

test("adds and removes only the selected price change", () => {
  const added = addMidShiftChange(report, "change-2");
  const removed = removeMidShiftChange(added, "change-1");

  assert.deepEqual(removed.midShiftPriceChanges.map((change) => change.id), ["change-2"]);
});

test("captures the original shift prices before the first mid-shift change", () => {
  const added = addMidShiftChange({ ...report, midShiftPriceChanges: [] }, "change-2");

  assert.deepEqual(added.midShiftBasePrices, report.prices);
  assert.equal(midShiftBasePrice(added, "Premium"), 74.5);
});

test("shows the latest mid-shift price without changing the protected base price", () => {
  const protectedReport = ensureMidShiftBasePrices(report);
  const changes = [
    { product: "Premium", effectiveTime: "12:00", newPrice: "75.20" },
    { product: "Premium", effectiveTime: "15:00", newPrice: "76.10" },
    { product: "Regular", effectiveTime: "14:00", newPrice: "74.30" },
  ];
  const displayed = pricesAfterMidShift(report.prices, changes);

  assert.equal(displayed.Premium, 76.1);
  assert.equal(displayed.Regular, 74.3);
  assert.equal(displayed.Diesel, 70.25);
  assert.equal(midShiftBasePrice(protectedReport, "Premium"), 74.5);
});

test("ignores blank or invalid mid-shift prices", () => {
  const displayed = pricesAfterMidShift(report.prices, [
    { product: "Premium", newPrice: "" },
    { product: "Diesel", newPrice: "not-a-price" },
  ]);

  assert.deepEqual(displayed, report.prices);
});

test("uses the corrected report price when a product has no mid-shift change", () => {
  const correctedReport = {
    prices: { Premium: 75.2, Regular: 74.2, Diesel: 72.4 },
    midShiftBasePrices: { Premium: 70, Regular: 69, Diesel: 68 },
    midShiftPriceChanges: [],
  };

  assert.equal(reportStartingPrice(correctedReport, "Premium"), 75.2);
});

test("preserves the original base price when the product has a real mid-shift change", () => {
  const changedReport = {
    prices: { Premium: 75.2 },
    midShiftBasePrices: { Premium: 70 },
    midShiftPriceChanges: [{ product: "Premium", effectiveTime: "10:00", newPrice: 75.2 }],
  };

  assert.equal(reportStartingPrice(changedReport, "Premium"), 70);
});
