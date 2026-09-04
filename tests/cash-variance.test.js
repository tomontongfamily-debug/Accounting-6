import assert from "node:assert/strict";
import test from "node:test";
import { depositAllocationDifference, physicalCashVariance } from "../src/cash-variance.js";

test("cash variance is physical cash counted minus expected cash", () => {
  assert.equal(physicalCashVariance(2250463, 2259959.97), -9496.97);
});

test("reports without a physical count do not create a fake shortage", () => {
  assert.equal(physicalCashVariance(0, 50000, false), 0);
});

test("missing deposits stay separate from physical cash variance", () => {
  assert.equal(depositAllocationDifference(0, 50000, 50000), 0);
});
