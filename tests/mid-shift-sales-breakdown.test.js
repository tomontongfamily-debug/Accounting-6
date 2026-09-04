import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { midShiftChangeOrder, midShiftReadingRows, midShiftSalesBreakdown } from "../src/mid-shift-sales-breakdown.js";

test("splits pump readings and sales before and after a mid-shift price change", () => {
  const rows = midShiftSalesBreakdown({
    shiftId: "shift-1",
    prices: { Premium: 70 },
    pumpRows: [{ id: "pump-1", pump: "Pump 1", nozzle: "Premium", product: "Premium", opening: 1000, closing: 1120 }],
    midShiftPriceChanges: [{ id: "change-1", product: "Premium", effectiveTime: "11:00", newPrice: 72, readings: { "Pump 1|Premium|Premium": 1080 } }],
  });

  assert.deepEqual(rows.map(({ fromLabel, toLabel, readingFrom, readingTo, liters, price, sales }) => (
    { fromLabel, toLabel, readingFrom, readingTo, liters, price, sales }
  )), [
    { fromLabel: "4:00 AM", toLabel: "11:00 AM", readingFrom: 1000, readingTo: 1080, liters: 80, price: 70, sales: 5600 },
    { fromLabel: "11:00 AM", toLabel: "1:00 PM", readingFrom: 1080, readingTo: 1120, liters: 40, price: 72, sales: 2880 },
  ]);
});

test("orders overnight shift changes across midnight", () => {
  assert.ok(midShiftChangeOrder({ effectiveTime: "23:00" }, "shift-3") < midShiftChangeOrder({ effectiveTime: "01:00" }, "shift-3"));
});

test("shows every saved product reading even when a sales segment cannot be calculated", () => {
  const rows = midShiftReadingRows({
    pumpRows: [
      { id: "premium-1", pump: "Pump 1", nozzle: "Premium", product: "Premium" },
      { id: "regular-1", pump: "Pump 1", nozzle: "Regular", product: "Regular" },
      { id: "diesel-1", pump: "Pump 2", nozzle: "Diesel", product: "Diesel" },
    ],
    midShiftPriceChanges: [
      { id: "premium-change", product: "Premium", effectiveTime: "15:00", newPrice: 82.2, readings: { "Pump 1|Premium|Premium": 1200 } },
      { id: "regular-change", product: "Regular", effectiveTime: "15:00", newPrice: 81.2, readings: { "Pump 1|Regular|Regular": 2200 } },
      { id: "diesel-change", product: "Diesel", effectiveTime: "15:00", newPrice: 79.4, readings: { "Pump 2|Diesel|Diesel": 3200 } },
    ],
  });

  assert.deepEqual(rows.map(({ product, reading }) => ({ product, reading })), [
    { product: "Premium", reading: 1200 },
    { product: "Regular", reading: 2200 },
    { product: "Diesel", reading: 3200 },
  ]);
});

test("calculates the active price when a change starts at the opening reading", () => {
  const rows = midShiftSalesBreakdown({
    shiftId: "shift-2",
    prices: { Premium: 80 },
    pumpRows: [{ id: "pump-1", pump: "Pump 1", nozzle: "Premium", product: "Premium", opening: 1000, closing: 1100 }],
    midShiftPriceChanges: [{ id: "change-1", product: "Premium", effectiveTime: "13:00", newPrice: 82, readings: { "Pump 1|Premium|Premium": 1000 } }],
  });

  assert.deepEqual(rows.map(({ liters, price, sales }) => ({ liters, price, sales })), [
    { liters: 100, price: 82, sales: 8200 },
  ]);
});

test("admin selected reports show the mid-shift sales breakdown", () => {
  const source = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /Mid-Shift Price Change/);
  assert.match(source, /All saved price-change readings/);
  assert.match(source, /Reading From/);
  assert.match(source, /Reading To/);
  assert.match(source, /Mid-Shift Period Total/);
});
