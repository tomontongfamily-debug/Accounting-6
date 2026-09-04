const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");
const sectionStart = app.indexOf('id="admin-section-summary"');
const sectionEnd = app.indexOf('{activeDesktopCategory === "consolidated"', sectionStart);

assert(sectionStart >= 0 && sectionEnd > sectionStart, "Daily Station Summary section should exist.");
const summarySection = app.slice(sectionStart, sectionEnd);

[
  "Fuel Sales",
  "Oil Sales",
  "Gross Sales",
  "Deductions",
  "Points Issued",
  "Points Withdrawn",
  "Expected Cash",
  "Bank Deposit",
  "Confirmed Bank",
  "Pending Verification",
  "Pending Cash On Hand",
  "Total PO",
  "Total PR",
  "Cash Variance",
  "Pump Variance",
  "Underground Tank Difference",
  "Premium Liters",
  "Regular Liters",
  "Diesel Liters",
  "Total Liters",
].forEach((label) => {
  assert(summarySection.includes(`title="${label}"`), `Daily Station Summary should include ${label}.`);
});

assert(!summarySection.includes('title="Coke Sold"'), "Daily Station Summary should not add extra Coke card in this change.");

console.log("Admin station summary field check passed.");
