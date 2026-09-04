const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(!app.includes('OWNER_BRANCH_LABELS = { Liloan: "Yati" }'), "Owner mobile should show Liloan, not Yati.");
assert(!app.includes("OWNER_CUSTOMER_DISCOUNTS"), "Owner margin should not subtract old customer discount rules.");
assert(!app.includes("Customer discount applied"), "Owner mobile should not display the old customer discount note.");
assert(!app.includes("Net Fuel Margin After Discount"), "Owner mobile should not label margin as after discount.");
assert(app.includes("Net Fuel Margin"), "Owner mobile should still show net fuel margin.");

const marginStart = app.indexOf("const marginRows = priceRows.map");
const marginEnd = app.indexOf("const tankRows", marginStart);
const marginBlock = app.slice(marginStart, marginEnd);
assert(marginBlock.includes("const productMargin = (product) =>"), "Owner margin should calculate each product independently.");
assert(marginBlock.includes("price - cost"), "Product margin should be price minus fuel cost.");
assert(!marginBlock.includes("- discount"), "Owner margin should not subtract a separate discount.");

assert(app.includes("ownerReportsSinceAccountingStart"), "Owner mobile should summarize confirmed reports since accounting start.");
assert(app.includes("ownerSummaryByBranch"), "Owner mobile should aggregate owner cash, bank, and PO totals by branch.");
assert(app.includes("ownerReportRangeLabel"), "Owner mobile should show the owner summary date range.");

assert(app.includes("fuelCostDraft"), "Desktop admin fuel costs should use a draft before confirm.");
assert(app.includes("fuelDeliveryCostRows"), "Desktop admin should list real delivery rows from submitted reports.");
assert(app.includes("selectedFuelDeliveryKey"), "Desktop admin should select a delivery row before entering cost.");
assert(app.includes("confirmFuelDeliveryCosts"), "Desktop admin fuel costs should save through a confirm button.");
assert(app.includes("Fuel Cost Confirmed"), "Desktop admin should show a sent/confirmed state.");
assert(app.includes("Date Delivered"), "Desktop admin should show date delivered.");
assert(app.includes("Shift Delivered"), "Desktop admin should show shift delivered.");
assert(app.includes("Amount of Liters"), "Desktop admin should show total delivery liters.");
assert(app.includes("Enter Cost"), "Desktop admin should have an action to enter delivery cost.");
assert(app.includes("Confirm Fuel Delivery Costs"), "Desktop admin should have a confirm button for fuel delivery costs.");

const cashierSection = app.slice(app.indexOf("function CashierPage"), app.indexOf("function ManagerPage"));
const managerSection = app.slice(app.indexOf("function ManagerPage"), app.indexOf("function MobileAdminMetric"));
assert(!cashierSection.includes("Fuel Delivery Costs"), "Cashier UI must not be changed for fuel delivery costs.");
assert(!managerSection.includes("Fuel Delivery Costs"), "Manager UI must not be changed for fuel delivery costs.");

console.log("Owner mobile and desktop admin fuel-cost check passed.");
