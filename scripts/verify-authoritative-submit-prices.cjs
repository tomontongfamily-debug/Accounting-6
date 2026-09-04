const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");
const saveApi = fs.readFileSync(path.join(__dirname, "..", "api", "reports", "save.js"), "utf8");

assert(app.includes("async function confirmReport()"), "Confirm should be able to refresh manager prices before opening the dialog.");
assert(app.includes("const latestPriceBook = await refreshCashierPrices(true);"), "Cashier confirm should fetch the latest manager prices.");
assert(app.includes("Latest manager prices applied. Opening report confirmation..."), "Cashier should receive a clear price-refresh status.");
assert(app.includes("cacheLocalDraft(pricedReport);"), "Applying manager prices must preserve the cashier's existing local draft.");
assert(saveApi.includes("async function loadAuthoritativeSellingPricing"), "Submission API must load authoritative manager prices.");
assert(saveApi.includes('.from("fueltech_price_book")'), "Submission API must use the live price book.");
assert(saveApi.includes("safeReport.prices = { ...(safeReport.prices || {}), ...authoritativePricing.prices };"), "Server must replace stale selling prices before validation.");
assert(
  saveApi.indexOf("safeReport.prices = { ...(safeReport.prices || {}), ...authoritativePricing.prices };")
    < saveApi.indexOf("const validationError = validateSubmission(safeReport);"),
  "Authoritative prices must be applied before submission validation.",
);

console.log("Authoritative manager-price submission check passed.");
