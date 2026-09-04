import test from "node:test";
import assert from "node:assert/strict";
import { validOpeningReading } from "../api/reports/save.js";

test("opening setup accepts an explicitly typed zero", () => {
  assert.equal(validOpeningReading("0"), true);
  assert.equal(validOpeningReading("0.0"), true);
});

test("opening setup keeps untouched ghost zero incomplete", () => {
  assert.equal(validOpeningReading(0), false);
  assert.equal(validOpeningReading(""), false);
  assert.equal(validOpeningReading(null), false);
});

test("opening setup accepts positive decimal readings", () => {
  assert.equal(validOpeningReading("512.75"), true);
  assert.equal(validOpeningReading(512.75), true);
});
