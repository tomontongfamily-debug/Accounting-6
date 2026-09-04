import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("overages above 100 and shortages below negative 1,500 are check required", () => {
  assert.match(appSource, /const REVIEW_CASH_VARIANCE_THRESHOLD = 1500;/);
  assert.match(appSource, /const REVIEW_CASH_OVERAGE_THRESHOLD = 100;/);
  assert.match(
    appSource,
    /cashVariance > REVIEW_CASH_OVERAGE_THRESHOLD \|\| cashVariance < -REVIEW_CASH_VARIANCE_THRESHOLD/
  );
});
