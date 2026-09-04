const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");
const saveApi = fs.readFileSync(path.join(__dirname, "..", "api", "reports", "save.js"), "utf8");

assert(
  app.includes("return pumpRows.every((row) => n(row.opening) > 0 && n(row.closing) >= n(row.opening));"),
  "Pump readings should allow current closing to equal previous closing."
);
assert(
  app.includes("return Math.max(0, closing - opening);"),
  "Equal pump readings should calculate as zero liters sold."
);
assert(
  app.includes("if (sold > 0 && n(report.prices[row.product]) <= 0) warnings.push(`${row.product}: pump price is missing or zero.`);"),
  "Pump price should only block when that pump row has sold liters."
);
assert(
  !app.includes('warning.includes("closing pump reading is lower")'),
  "A lower current closing should not block cashier submission."
);
assert(
  app.includes("function pumpVarianceAmount(report, row)"),
  "Admin should retain the pump discrepancy calculation for lower readings."
);
assert(
  !saveApi.includes("current closing cannot be lower than previous closing"),
  "The server should no longer reject a lower current closing."
);

console.log("Zero-sales closed-station shift check passed.");
