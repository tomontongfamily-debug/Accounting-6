const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(source.includes('"FuelTech Pay Total"'), "Cashier app should show FuelTech Pay Total.");
assert(source.includes('const FUELTECH_PAY_KEYS = ["gcash", "card", "paymaya"]'), "FuelTech Pay Total should include PayMaya.");
assert(source.includes("fuelTechPayTotal(report.deductions)"), "FuelTech Pay Total should combine stored payment fields.");
assert(source.includes("summary.fuelTechPayTotal"), "Detailed export should include FuelTech Pay Total.");
assert(!source.includes('"GCASH", "PAYMAYA", "CC/DC"'), "Detailed export should not split GCash and card as separate main columns.");
assert(!source.includes('"FUELTECH PAY TOTAL", "PAYMAYA"'), "Detailed export should not keep PayMaya as a separate main column.");
assert(!source.includes('"COKE RELEASE", "DISCOUNTS"'), "Detailed export should not keep Discounts as a separate main column.");

console.log("FuelTech Pay Total label check passed.");
