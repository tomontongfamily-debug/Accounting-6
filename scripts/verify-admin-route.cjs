const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

const roleSelectorMatch = source.match(/if \(!role\) \{[\s\S]*?return \([\s\S]*?<\/main>\s*\);\s*\}/);
assert(roleSelectorMatch, "Could not find the base role selector screen.");

const roleSelector = roleSelectorMatch[0];
assert(!roleSelector.includes("Open Admin"), "Base / role selector must not show an Admin button.");
assert(roleSelector.includes("Open Cashier"), "Base / role selector should still show Cashier.");
assert(roleSelector.includes("Open Manager"), "Base / role selector should still show Manager.");
assert(source.includes('if (pathname === "/admin") return "Admin";'), "/admin must still route to Admin.");

console.log("Admin route safety check passed.");
