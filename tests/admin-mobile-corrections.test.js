import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../public/fueltech-sw.js", import.meta.url), "utf8");
const subscribeSource = readFileSync(new URL("../api/notifications/subscribe.js", import.meta.url), "utf8");
const saveSource = readFileSync(new URL("../api/reports/save.js", import.meta.url), "utf8");

test("mobile admin exposes correction approvals", () => {
  assert.match(appSource, /Corrections\{correctionRequests\.length/);
  assert.match(appSource, /approveCorrectionRequest\(requestReport\)/);
  assert.match(appSource, /rejectCorrectionRequest\(requestReport\)/);
});

test("push subscription endpoint is admin-only", () => {
  assert.match(subscribeSource, /auth\.session\.role !== "Admin"/);
  assert.match(subscribeSource, /savePushSubscription/);
});

test("new correction requests trigger the push notifier after saving", () => {
  assert.match(saveSource, /await sendCorrectionRequestNotification\(supabase, written\.data\)/);
});

test("service worker displays and opens correction notifications", () => {
  assert.match(workerSource, /addEventListener\("push"/);
  assert.match(workerSource, /showNotification/);
  assert.match(workerSource, /\/admin\?view=corrections/);
  assert.match(workerSource, /addEventListener\("notificationclick"/);
});
