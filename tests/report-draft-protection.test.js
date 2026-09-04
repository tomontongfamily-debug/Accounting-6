import test from "node:test";
import assert from "node:assert/strict";
import { erasesCompletedDraftFields, mergeReportForRole, reportWithPendingCorrection } from "../api/reports/save.js";

function report({ closings = 0, dips = 0, cashierName = "", actualCashCounted = "" } = {}) {
  return {
    pumpRows: Array.from({ length: 3 }, (_, index) => ({
      closingEntered: index < closings,
    })),
    tankRows: Array.from({ length: 3 }, (_, index) => ({
      actualDip: index < dips ? 100 + index : "",
    })),
    cashierName,
    actualCashCounted,
  };
}

test("rejects an empty stale draft replacing completed fields", () => {
  const online = report({ closings: 3, dips: 3, cashierName: "Cashier", actualCashCounted: 12000 });
  assert.equal(erasesCompletedDraftFields(report(), online), true);
});

test("allows a newer draft that adds progress", () => {
  const online = report({ closings: 1, dips: 1 });
  const incoming = report({ closings: 2, dips: 2, cashierName: "Cashier" });
  assert.equal(erasesCompletedDraftFields(incoming, online), false);
});

test("rejects removal of cashier name or physical cash count", () => {
  const online = report({ cashierName: "Cashier", actualCashCounted: 5000 });
  assert.equal(erasesCompletedDraftFields(report({ actualCashCounted: 5000 }), online), true);
  assert.equal(erasesCompletedDraftFields(report({ cashierName: "Cashier" }), online), true);
});

test("cashier saves preserve manager mid-shift pricing and its original base prices", () => {
  const existing = {
    ...report({
      closings: 1,
      dips: 1,
      cashierName: "Cashier",
      actualCashCounted: 5000,
    }),
    midShiftPriceChanges: [{ id: "price-1", product: "Premium", newPrice: 75.2 }],
    midShiftBasePrices: { Premium: 74.5, Regular: 73.5, Diesel: 70.25 },
  };
  const merged = mergeReportForRole(
    { role: "Cashier" },
    { ...report(), midShiftPriceChanges: [] },
    existing
  );

  assert.deepEqual(merged.midShiftPriceChanges, existing.midShiftPriceChanges);
  assert.deepEqual(merged.midShiftBasePrices, existing.midShiftBasePrices);
});

test("manager first save keeps the original prices for mid-shift calculations", () => {
  const incoming = {
    ...report(),
    branch: "Pondol",
    date: "2026-07-31",
    shiftId: "shift-1",
    prices: { Premium: 74.5, Regular: 73.5, Diesel: 70.25 },
    midShiftPriceChanges: [{ id: "price-1", product: "Premium", newPrice: 75.2 }],
  };
  const merged = mergeReportForRole({ role: "Manager" }, incoming);

  assert.deepEqual(merged.midShiftBasePrices, incoming.prices);
});

test("adds a correction request without changing a locked submitted report", () => {
  const submitted = {
    branch: "Pondol",
    date: "2026-07-27",
    shiftId: "shift-1",
    confirmed: true,
    confirmedAt: "2026-07-27T05:00:00.000Z",
    pumpRows: [{ id: "pump-1", opening: 100, closing: 125.5 }],
    deposits: [{ id: "deposit-1", amount: 5000, verified: true }],
    actualCashCounted: 12500,
    serverMeta: { version: 7, reportId: "FT-PON-20260727-1-TEST", lockedAt: "2026-07-27T05:00:00.000Z" },
  };
  const incoming = {
    ...submitted,
    confirmed: false,
    pumpRows: [],
    deposits: [],
    correctionRequest: { reason: "Correct one pump reading" },
  };

  const updated = reportWithPendingCorrection(submitted, incoming, "2026-07-27T06:00:00.000Z", "request-1");
  const { correctionRequest, ...unchangedReport } = updated;

  assert.deepEqual(unchangedReport, submitted);
  assert.deepEqual(correctionRequest, {
    id: "request-1",
    status: "pending",
    branch: "Pondol",
    reportDate: "2026-07-27",
    shiftId: "shift-1",
    reason: "Correct one pump reading",
    requestedAt: "2026-07-27T06:00:00.000Z",
    approvedAt: "",
    rejectedAt: "",
    expiresAt: "",
    completedAt: "",
  });
});
