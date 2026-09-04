import assert from "node:assert/strict";
import test from "node:test";

import { shiftIdForEffectiveTime } from "../src/shift-time.js";

test("effective time determines the correct station shift", () => {
  assert.equal(shiftIdForEffectiveTime("04:00"), "shift-1");
  assert.equal(shiftIdForEffectiveTime("10:15"), "shift-1");
  assert.equal(shiftIdForEffectiveTime("12:59"), "shift-1");
  assert.equal(shiftIdForEffectiveTime("13:00"), "shift-2");
  assert.equal(shiftIdForEffectiveTime("13:50"), "shift-2");
  assert.equal(shiftIdForEffectiveTime("21:59"), "shift-2");
  assert.equal(shiftIdForEffectiveTime("22:00"), "shift-3");
  assert.equal(shiftIdForEffectiveTime("03:59"), "shift-3");
});

test("invalid effective times do not select a shift", () => {
  assert.equal(shiftIdForEffectiveTime(""), "");
  assert.equal(shiftIdForEffectiveTime("25:00"), "");
  assert.equal(shiftIdForEffectiveTime("10:75"), "");
});
