const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");
const health = fs.readFileSync(path.join(__dirname, "..", "api", "_shared", "health.js"), "utf8");

assert(!app.includes("OWNER_REFERENCE_COSTS"), "Owner margin must not use guessed reference costs.");
assert(app.includes("defaultFuelCosts"), "Fuel cost defaults should be saved with the price book.");
assert(app.includes("fuelCostForProduct"), "Owner margin should read real fuel delivery costs.");
assert(app.includes("latestFuelCostsForBranch"), "Owner margin should use latest saved fuel delivery costs through today.");
assert(app.includes("patchFuelDeliveryCosts"), "Admin should be able to save fuel delivery costs.");
assert(app.includes('{ id: "fuel-costs", label: "Fuel Costs" }'), "Admin desktop should have a Fuel Costs category.");
assert(app.includes('title="Fuel Delivery Costs"'), "Admin desktop should show the Fuel Delivery Costs section.");
assert(app.includes("fuelDeliveryCostRows"), "Admin fuel costs should start from real submitted delivery rows.");
assert(app.includes("fuelCostDraft"), "Fuel cost inputs should use a draft before saving.");
assert(app.includes("confirmFuelDeliveryCosts"), "Fuel costs should save only after admin confirms.");
assert(app.includes("Date Delivered"), "Fuel cost UI should show date delivered.");
assert(app.includes("Shift Delivered"), "Fuel cost UI should show shift delivered.");

const clientDeductionLine = app.match(/const deductionTotal = .*;/)?.[0] || "";
assert(!clientDeductionLine.includes("pointsWithdrawn"), "Expected cash should not subtract points withdrawn.");
assert(!health.includes("+ numberValue(report.pointsWithdrawn)"), "Health expected cash should not subtract points withdrawn.");

assert(app.includes('value="Uses real costs"'), "Owner margin status should explain it uses real costs.");
assert(app.includes('return `${peso(value)}${suffix}`;'), "Missing margin costs should display as Not set through ownerPeso.");
assert(!app.includes("OWNER_CUSTOMER_DISCOUNTS"), "Owner margin should not subtract old customer discount rules.");

console.log("Fuel cost margin and points formula check passed.");
