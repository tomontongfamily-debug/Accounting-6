const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(app.includes("function deliveryLitersByProductForBranchDate"), "Fuel costs should read cashier-entered delivery liters.");
assert(app.includes("function fuelDeliveryCostRows"), "Fuel costs should list submitted reports with cashier-entered delivery liters.");
assert(app.includes("adminFuelDeliveryRows"), "Admin Fuel Costs should show delivery rows before cost entry.");
assert(app.includes("selectedFuelDeliveryKey"), "Admin Fuel Costs should select one delivery row for editing.");
assert(app.includes("adminDeliveryLiters"), "Admin Fuel Costs should calculate delivery liters for the selected delivery row.");
assert(app.includes("const hasDelivery = n(adminDeliveryLiters[product]) > 0;"), "Fuel cost input should depend on product delivery liters.");
assert(app.includes("Delivery Entered"), "Admin should see the cashier-entered delivery liters.");
assert(app.includes("No cashier delivery entered"), "Admin should see why a cost field is locked.");
assert(app.includes("Needs Confirm"), "Admin should see unconfirmed delivery-cost rows.");
assert(app.includes("Cost Saved"), "Admin should see confirmed delivery-cost rows.");
assert(app.includes("patchFuelCostDraft(product, value)"), "Products with delivery should edit a draft cost first.");
assert(app.includes("confirmFuelDeliveryCosts"), "Fuel delivery costs should save after admin confirms.");
assert(app.includes("read-only-value"), "Products without delivery should show read-only cost instead of an editable input.");

console.log("Fuel costs require delivery check passed.");
