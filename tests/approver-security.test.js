import test from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, verifySessionToken, canWriteBranch } from "../api/_shared/session.js";
import { reportForRole, pricesForRole } from "../api/store/load.js";
import { canApproveBankDeposit } from "../api/deposits/verify.js";
import { canReviewDepositRemoval, reviewedDeposit } from "../api/deposits/removal.js";

test("approver session is all-station but cannot use generic report writes", () => {
  const previousSecret = process.env.FUELTECH_SESSION_SECRET;
  process.env.FUELTECH_SESSION_SECRET = "approver-security-test-secret";
  const token = createSessionToken({ role: "Approver", branch: "Mabolo" });
  const verified = verifySessionToken(token);
  assert.equal(verified.ok, true);
  assert.equal(verified.session.role, "Approver");
  assert.equal(verified.session.branch, "");
  assert.equal(canWriteBranch(verified.session, "Mabolo"), false);
  if (previousSecret === undefined) delete process.env.FUELTECH_SESSION_SECRET;
  else process.env.FUELTECH_SESSION_SECRET = previousSecret;
});

test("approver receives deposit-only report data", () => {
  const report = {
    confirmed: true,
    baselineConfirmed: true,
    baselineReport: true,
    cashierName: "Hidden Cashier",
    pumpRows: [{ opening: 100, closing: 110 }],
    deductions: { gcash: 500 },
    deposits: [{ id: "dep-1", bank: "Bank", reference: "123", amount: 1000, verified: false, removalRequested: true, removalRequestType: "change" }],
  };
  const visible = reportForRole(report, "Approver");
  assert.equal(visible.confirmed, true);
  assert.equal(visible.openingSetupComplete, true);
  assert.equal(visible.deposits.length, 1);
  assert.equal(visible.deposits[0].removalRequested, true);
  assert.equal(visible.deposits[0].removalRequestType, "change");
  assert.equal(visible.cashierName, undefined);
  assert.equal(visible.pumpRows, undefined);
  assert.equal(visible.deductions, undefined);
  assert.deepEqual(pricesForRole({ Premium: 70 }, "Approver"), {});
});

test("only admin and approver may call the bank approval endpoint", () => {
  assert.equal(canApproveBankDeposit({ role: "Approver" }), true);
  assert.equal(canApproveBankDeposit({ role: "Admin" }), true);
  assert.equal(canApproveBankDeposit({ role: "Manager" }), false);
  assert.equal(canApproveBankDeposit({ role: "Cashier" }), false);
});

test("only admin and approver may review removal requests", () => {
  assert.equal(canReviewDepositRemoval({ role: "Approver" }), true);
  assert.equal(canReviewDepositRemoval({ role: "Admin" }), true);
  assert.equal(canReviewDepositRemoval({ role: "Manager" }), false);
  assert.equal(canReviewDepositRemoval({ role: "Cashier" }), false);
});

test("deposit removal review changes only request fields", () => {
  const deposit = {
    id: "dep-1",
    bank: "Bank",
    amount: 1000,
    verified: true,
    removalRequested: true,
    removal_requested: true,
    removalRequestType: "removal",
  };
  const approved = reviewedDeposit(deposit, "approve", "Approver", "2026-07-29T00:00:00.000Z");
  assert.equal(approved.removed, true);
  assert.equal(approved.removalRequested, false);
  assert.equal(approved.verified, true);
  assert.equal(approved.bank, "Bank");

  const rejected = reviewedDeposit(deposit, "reject", "Approver", "2026-07-29T00:00:00.000Z");
  assert.equal(rejected.removed, undefined);
  assert.equal(rejected.removalRequested, false);
  assert.equal(rejected.verified, true);
  assert.equal(rejected.bank, "Bank");
});
