import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewMessage, reviewGreeting } from "../src/review-message.js";

test("uses a time-appropriate greeting", () => {
  assert.equal(reviewGreeting(8), "Good morning");
  assert.equal(reviewGreeting(14), "Good afternoon");
  assert.equal(reviewGreeting(20), "Good evening");
});

test("builds a direct manager cash-variance follow-up message", () => {
  const message = buildReviewMessage({
    cashierName: "Jake",
    branch: "Moalboal",
    date: "2026-07-30",
    shiftLabel: "Shift 2 - 1:00 PM to 10:00 PM",
    expectedCash: 100000,
    actualCashCounted: 87,
    actualCashCountEntered: true,
    cashVariance: -99913,
    flags: ["High cash variance"],
    hour: 9,
  });

  assert.match(message, /^Good morning\./);
  assert.match(message, /Jake's Shift 2 - 1:00 PM to 10:00 PM report at Moalboal on July 30, 2026/);
  assert.match(message, new RegExp(`negative cash variance of ${String.raw`\u20b1`}99,913\\.00`));
  assert.match(message, new RegExp(`Expected cash is ${String.raw`\u20b1`}100,000\\.00`));
  assert.match(message, new RegExp(`physical cash counted is ${String.raw`\u20b1`}87\\.00`));
  assert.match(message, /Please double-check/);
  assert.doesNotMatch(message, /Good morning, Jake/);
});

test("labels an overage as a positive variance", () => {
  const message = buildReviewMessage({
    cashierName: "M Lapinig",
    branch: "Liloan",
    date: "2026-07-30",
    shiftLabel: "Shift 1 - 4:00 AM to 1:00 PM",
    expectedCash: 10000,
    actualCashCounted: 12500,
    actualCashCountEntered: true,
    cashVariance: 2500,
    flags: ["High cash variance"],
    hour: 8,
  });

  assert.match(message, /^Good morning\./);
  assert.match(message, /M Lapinig's Shift 1/);
  assert.match(message, new RegExp(`positive cash variance of ${String.raw`\u20b1`}2,500\\.00`));
});
