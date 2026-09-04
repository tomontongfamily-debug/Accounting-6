const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(app.includes("localChangeVersionRef"), "App should track local edit versions.");
assert(app.includes("const refreshStartedAtVersion = localChangeVersionRef.current"), "Refresh should record the local edit version when it starts.");
assert(app.includes("if (refreshStartedAtVersion !== localChangeVersionRef.current || pendingSaveCountRef.current > 0) return;"), "Every stale refresh result should be ignored after local edits or while saves remain queued.");
assert(app.includes("localChangeVersionRef.current = nextDeviceSaveVersion(localChangeVersionRef.current)"), "Report and price edits should advance a refresh-safe device save version.");
assert(app.includes("pendingSaveCountRef.current += 1"), "Each queued save should increment the pending-save count immediately.");
assert(app.includes("pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1)"), "Each completed save should decrement the pending-save count.");
assert(app.includes("setIsSavingOnline(pendingSaveCountRef.current > 0)"), "Saving status should remain active until every queued save finishes.");

console.log("Refresh race guard check passed.");
