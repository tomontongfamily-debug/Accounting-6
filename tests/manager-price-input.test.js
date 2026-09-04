import test from "node:test";
import assert from "node:assert/strict";
import { committedManagerPrice, insertManagerPriceDecimal, normalizeManagerPriceDraft } from "../src/managerPrice.js";

test("manager price input preserves decimal typing", () => {
  assert.equal(normalizeManagerPriceDraft("75."), "75.");
  assert.equal(normalizeManagerPriceDraft("75.2"), "75.2");
  assert.equal(normalizeManagerPriceDraft("75.20"), "75.20");
  assert.equal(committedManagerPrice("75.20"), "75.20");
});

test("manager price input accepts decimal comma and blocks invalid values", () => {
  assert.equal(normalizeManagerPriceDraft("75,20"), "75.20");
  assert.equal(normalizeManagerPriceDraft("75．20"), "75.20");
  assert.equal(normalizeManagerPriceDraft("75٫20"), "75.20");
  assert.equal(committedManagerPrice("75,20"), "75.20");
  assert.equal(normalizeManagerPriceDraft("75.20.5"), null);
  assert.equal(normalizeManagerPriceDraft("-1"), null);
});

test("manager price keypad decimal inserts visibly at the cursor", () => {
  assert.deepEqual(insertManagerPriceDecimal("75", 2, 2), { value: "75.", caret: 3 });
  assert.deepEqual(insertManagerPriceDecimal("7520", 2, 4), { value: "75.", caret: 3 });
  assert.deepEqual(insertManagerPriceDecimal("75.20", 5, 5), { value: "75.20", caret: 3 });
});
