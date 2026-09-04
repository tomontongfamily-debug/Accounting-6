import test from "node:test";
import assert from "node:assert/strict";
import { validateSubmission } from "../api/reports/save.js";

function validReport(closing) {
  return {
    date: "2026-07-29",
    cashierName: "Test Cashier",
    prices: { Premium: 70 },
    pumpRows: [{
      id: "pump-1-premium",
      pump: "Pump 1",
      nozzle: "Premium",
      product: "Premium",
      opening: 10000,
      closing,
      closingEntered: true,
    }],
    tankRows: [{ tank: "Premium", actualDip: 5000 }],
    actualCashCounted: 1000,
  };
}

test("server rejects negative pump liters", () => {
  assert.match(validateSubmission(validReport(9999.99)), /negative liters are not allowed/i);
});

test("server rejects more than 1,500 liters on one pump product", () => {
  assert.match(validateSubmission(validReport(11500.01)), /exceeds the 1,500 L maximum/i);
});

test("server allows equal readings and exactly 1,500 liters", () => {
  assert.equal(validateSubmission(validReport(10000)), "");
  assert.equal(validateSubmission(validReport(11500)), "");
});

test("server accepts a complete cash voucher on new reports", () => {
  const report = {
    ...validReport(10010),
    purchaseRows: [{ category: "OPEX", item: "Generator oil", amount: 850.5 }],
  };
  assert.equal(validateSubmission(report), "");
});

test("server requires cash voucher category, particular, and positive amount", () => {
  const report = validReport(10010);
  report.purchaseRows = [{ category: "", item: "Generator oil", amount: 850.5 }];
  assert.match(validateSubmission(report), /OPEX, Personal, or Construction category/i);

  report.purchaseRows = [{ category: "Personal", item: "", amount: 850.5 }];
  assert.match(validateSubmission(report), /particular/i);

  report.purchaseRows = [{ category: "Construction", item: "Cement", amount: 0 }];
  assert.match(validateSubmission(report), /amount greater than zero/i);
});

test("historical purchase requests remain readable without a category", () => {
  const report = {
    ...validReport(10010),
    date: "2026-07-28",
    purchaseRows: [{ item: "Historical purchase", amount: 500 }],
  };
  assert.equal(validateSubmission(report), "");
});
