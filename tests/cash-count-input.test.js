import assert from "node:assert/strict";
import test from "node:test";
import { formatCashCountInput, normalizeCashCountInput } from "../src/cash-count-input.js";

test("automatically groups a five-digit cash count with a comma", () => {
  assert.equal(normalizeCashCountInput("87298"), "87298");
  assert.equal(formatCashCountInput("87298"), "87,298");
});

test("keeps an intentionally entered period as a decimal", () => {
  assert.equal(normalizeCashCountInput("87.298"), "87.298");
  assert.equal(formatCashCountInput("87.298"), "87.298");
});

test("treats commas only as thousands separators", () => {
  assert.equal(normalizeCashCountInput("87,298"), "87298");
  assert.equal(formatCashCountInput("87,298"), "87,298");
  assert.equal(normalizeCashCountInput("1,234,567.50"), "1234567.50");
  assert.equal(formatCashCountInput("1,234,567.50"), "1,234,567.50");
});

test("rejects negative, alphabetic, and malformed cash counts", () => {
  assert.equal(normalizeCashCountInput("-100"), null);
  assert.equal(normalizeCashCountInput("87/298"), null);
  assert.equal(normalizeCashCountInput("87.29.8"), null);
});
