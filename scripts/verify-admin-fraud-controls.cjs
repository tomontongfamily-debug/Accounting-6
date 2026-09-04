const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(!app.includes("Perfect zero variance with pending cash"), "Suspicious perfect-zero flag should be removed.");
assert(!app.includes("function duplicateDepositKeys"), "Duplicate bank transfer helper should be removed.");
assert(!app.includes("Duplicate Bank Transfers"), "Duplicate bank transfer flag should be removed.");
assert(app.includes("function priceChangeHistoryRows"), "Admin should build price change history rows.");
assert(app.includes('id: "price-history"'), "Desktop admin should have a Price History category.");
assert(app.includes("Price Change History"), "Desktop admin should show price change history.");
assert(app.includes("function groupedDepositRows"), "Manager deposit display should group combined deposits.");
assert(app.includes("groupedManagerDepositRows"), "Manager daily bank deposit table should show grouped combined deposits.");
assert(app.includes(".filter((item) => item?.branch === branch)"), "Manager saved deposits should show station deposits beyond the selected sales date.");
assert(app.includes("depositHistoryFrom"), "Manager should have Deposit From history control.");
assert(app.includes("depositHistoryTo"), "Manager should have Deposit To history control.");
assert(app.includes("Deposit From"), "Manager UI should label Deposit From.");
assert(app.includes("Deposit To"), "Manager UI should label Deposit To.");
assert(app.includes("Request Change"), "Manager should be able to request a deposit change.");
assert(app.includes("Change Requested"), "Admin should see deposit change requests.");
assert(app.includes("Approve Change"), "Admin should be able to approve a deposit change request.");
assert(!app.includes("No bank deposits saved for this sales date yet."), "Manager deposit table should not look empty just because the selected sales date changed.");

const cashierSection = app.slice(app.indexOf("function CashierPage"), app.indexOf("function ManagerPage"));
const managerSection = app.slice(app.indexOf("function ManagerPage"), app.indexOf("function MobileAdminMetric"));
assert(!cashierSection.includes("Duplicate Bank Transfers"), "Cashier UI should not receive duplicate-bank controls.");
assert(!managerSection.includes("Price Change History"), "Manager UI should not receive admin price history.");
assert(!managerSection.includes('title="Gross Sales"'), "Manager summary should not show gross sales.");
assert(!managerSection.includes('title="Cash Variance"'), "Manager summary should not show cash variance.");

console.log("Admin fraud-control check passed.");
