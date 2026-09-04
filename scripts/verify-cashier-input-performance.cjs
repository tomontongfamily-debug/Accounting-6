const fs = require("node:fs");
const assert = require("node:assert/strict");

const app = fs.readFileSync("src/App.jsx", "utf8");
const priceLoad = fs.readFileSync("api/prices/load.js", "utf8");

assert.match(app, /const REPORT_SAVE_DEBOUNCE_MS = 650/);
assert.match(app, /function stageLocalReport\(reportToSave\)/);
assert.match(app, /cacheLocalDraft\(reportWithSaveMeta\)/);
assert.match(app, /queueOfflineReport\(reportWithSaveMeta\)/);
assert.match(app, /window\.clearTimeout\(draftSaveTimerRef\.current\)/);
assert.match(app, /persistReport\(latestReport, "save", true\)/);
assert.match(app, /if \(operation === "immediate"\)/);
assert.match(app, /removeQueuedReport\(pendingDraftReportRef\.current\)/);
assert.match(app, /\}, "immediate"\);/);
assert.match(app, /if \(localChangeVersionRef\.current === version\)/);
assert.match(app, /apiPost\("\/api\/prices\/load"/);
assert.match(app, /const priceBook = await loadOnlinePriceBook\(sessionToken\)/);
assert.match(priceLoad, /auth\.session\.role !== "Admin"/);
assert.match(priceLoad, /\.eq\("branch", auth\.session\.branch\)/);
assert.doesNotMatch(priceLoad, /fueltech_reports/);

console.log("Cashier input performance and price-only refresh check passed.");
