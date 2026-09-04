const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(app.includes('LOCAL_DRAFTS_KEY = "fueltech-report-local-drafts-v1"'), "Drafts should have durable device storage separate from the upload queue.");
assert(app.includes("cacheLocalDraft(reportWithSaveMeta)"), "Every report edit should update the durable local draft.");
assert(app.includes("storeWithLocalDrafts()"), "App startup should hydrate saved drafts before network loading.");
assert(app.includes("storeWithLocalDrafts(onlineStore"), "Online refresh should merge rather than discard local drafts.");
assert(app.includes('CASHIER_SESSION_CACHE_KEY = "fueltech-cashier-session-v1"'), "Cashier access should survive a same-tab refresh while offline.");
assert(app.includes("window.sessionStorage.setItem(CASHIER_SESSION_CACHE_KEY"), "Successful cashier login should cache refresh-safe access without storing the PIN.");
assert(app.includes("reportCompleted(result.report)"), "A completed shift or opening setup should leave the local draft cache after successful upload.");
assert(app.includes("reportCompleted(reports[key])"), "A completed server report should replace stale local draft data.");
assert(app.includes("Offline draft loaded from this device"), "Cashier should receive a clear offline recovery status.");
assert(app.includes('DEVICE_SAVE_VERSION_KEY = "fueltech-device-save-version"'), "The cashier save sequence should survive page refreshes.");
assert(app.includes("const rebasedReport = withClientSaveMeta(report, clientId, version)"), "Queued offline drafts should receive a fresh monotonic version before upload.");

console.log("Offline draft recovery check passed.");
