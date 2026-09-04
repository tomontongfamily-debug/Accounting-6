import test from "node:test";
import assert from "node:assert/strict";
import { isCleanRestartRejection, shouldDiscardOfflineReport } from "../src/offline-report.js";

test("discards only device reports older than the clean opening date", () => {
  assert.equal(shouldDiscardOfflineReport({ branch: "Mabolo", date: "2026-07-28", shiftId: "shift-3" }, "2026-07-29"), true);
  assert.equal(shouldDiscardOfflineReport({ branch: "Mabolo", date: "2026-07-29", shiftId: "shift-3" }, "2026-07-29"), false);
  assert.equal(shouldDiscardOfflineReport({ branch: "Mabolo", date: "2026-08-14", shiftId: "shift-1" }, "2026-07-29"), false);
});

test("recognizes the server clean-restart rejection", () => {
  assert.equal(isCleanRestartRejection({ status: 409, message: "This report is from before the clean restart and cannot be uploaded." }), true);
  assert.equal(isCleanRestartRejection({ status: 409, message: "Another device saved first." }), false);
});
