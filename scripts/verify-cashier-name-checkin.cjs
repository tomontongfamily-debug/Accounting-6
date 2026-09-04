const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(!app.includes("Cashier Check-In"), "Cashier name should not interrupt the report with a check-in popup.");
assert(app.includes("const [cashierNameDraft"), "Cashier name typing should use a stable local draft.");
assert(app.includes("patchReport([\"root\", \"cashierName\"], name)"), "The Step 7 field should save the trimmed cashier name to the report.");
assert(app.includes("onBlur={saveCashierName}"), "Cashier Information should retain an editable name field.");
assert(app.includes("maxLength={80}"), "Cashier names should have a reasonable length limit.");
assert(!app.includes("Refresh Manager Price"), "Cashier should not need a manual manager-price refresh button.");
assert(app.includes("const CASHIER_PRICE_REFRESH_MS = 10_000"), "Manager prices should sync automatically to an open cashier report.");
assert(app.includes("const priceBook = await loadOnlinePriceBook(sessionToken)"), "Cashier price refresh should download prices only.");
assert(app.includes("setStore((old) => ({ ...old, priceBook }))"), "Price refresh should preserve cashier report inputs.");

console.log("Cashier name and manager-price refresh check passed.");
