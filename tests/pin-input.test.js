import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBranchPinDraft, normalizePinForComparison } from "../src/pin-input.js";

test("branch PIN accepts six numeric digits", () => {
  assert.equal(normalizeBranchPinDraft("123456"), "123456");
  assert.equal(normalizeBranchPinDraft("1234567"), "123456");
});

test("branch PIN normalizes mobile full-width digits and ignores separators", () => {
  assert.equal(normalizeBranchPinDraft("１２３ ４５-６"), "123456");
});

test("server comparison ignores accidental spaces without changing leading zeroes", () => {
  assert.equal(normalizePinForComparison(" 012 345 "), "012345");
});
