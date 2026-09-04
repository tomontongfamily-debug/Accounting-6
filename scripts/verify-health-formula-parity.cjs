const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const { computeReportCash } = await import(pathToFileURL(path.join(__dirname, "..", "api", "_shared", "health.js")));
  const report = {
    prices: { Premium: 70 },
    pumpRows: [{ id: "p1", product: "Premium", opening: 100, closing: 120 }],
    tankRows: [{ product: "Premium", calibration: 2 }],
    midShiftPriceChanges: [{ product: "Premium", effectiveTime: "10:00", newPrice: 72, readings: { p1: 110 } }],
    deductions: { gcash: 100, calibrationCash: 999 },
    poRows: [{ amount: 50 }],
    purchaseRows: [{ amount: 25 }],
    oilSales: 75,
    deposits: [{ amount: 500, verified: false }],
  };
  const result = computeReportCash(report);
  assert.equal(result.grossSales, 1353, "Server health should apply mid-shift prices and remove returned calibration from sales.");
  assert.equal(result.expectedCash, 1178, "Server health expected cash should match app deductions.");
  assert.equal(result.pendingCashOnHand, 678, "Undeposited expected cash should remain pending cash on hand.");
  assert.equal(result.cashVariance, 0, "A partial deposit plus pending cash should not create a false negative variance.");
  console.log("Server health formula parity check passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
