import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("manager mid-shift price entries have a confirmation action", () => {
  assert.match(appSource, /Confirm \{change\.product\} Mid-Shift Price/);
  assert.match(appSource, /saveReport\(confirmedReport, "immediate"\)/);
  assert.match(appSource, /Complete every \$\{change\.product\} price-change pump reading before confirming/);
  assert.match(appSource, /saveOnlinePrices\(branch, latestReport\.date, "Daily", "daily", nextDailyPrices, sessionToken\)/);
  assert.match(appSource, /setPricingCoverage\("Daily"\)/);
});
