const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const preview = fs.readFileSync(path.join(root, "cashier-step-wizard-preview.html"), "utf8");

assert(app.includes('DEVICE_CLIENT_ID_KEY = "fueltech-device-client-id"'), "Cashier device ID should have a stable storage key.");
assert(app.includes("window.localStorage.getItem(DEVICE_CLIENT_ID_KEY)"), "Cashier should reuse its device ID after reload.");
assert(app.includes("useState(() => deviceClientId())"), "Edit leases should use the stable device ID.");
assert(preview.includes('inputmode="decimal" placeholder="0"'), "Preview current closing should start empty with ghost zero.");
assert(preview.includes("cannot open, edit, or lock a live report"), "Preview should clearly explain it cannot affect live reports.");

console.log("Stable cashier device lease and preview check passed.");
