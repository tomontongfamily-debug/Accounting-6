import test from "node:test";
import assert from "node:assert/strict";
import { cashierReportDateDisplay } from "../src/cashier-date.js";

test("shows the current date before cashier authentication", () => {
  assert.equal(cashierReportDateDisplay({
    accessAllowed: false,
    currentDate: "2026-07-27",
    initialLoadFinished: false,
    initialLoadError: "",
    activeDate: "2026-07-21",
  }), "2026-07-27");
});

test("does not expose a fallback date while authenticated reports are loading", () => {
  assert.equal(cashierReportDateDisplay({
    accessAllowed: true,
    currentDate: "2026-07-27",
    initialLoadFinished: false,
    initialLoadError: "",
    activeDate: "2026-07-21",
  }), "Loading...");
});

test("shows the authenticated reporting date after loading", () => {
  assert.equal(cashierReportDateDisplay({
    accessAllowed: true,
    currentDate: "2026-07-27",
    initialLoadFinished: true,
    initialLoadError: "",
    activeDate: "2026-07-26",
  }), "2026-07-26");
});
