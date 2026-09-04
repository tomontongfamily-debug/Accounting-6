const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const css = fs.readFileSync(path.join(__dirname, "..", "src", "styles.css"), "utf8");

assert(!css.includes(".owner-mobile-panel {\n    margin: -16px;"), "Owner mobile panel must not use a negative margin on phones.");
assert(!css.includes(".owner-mobile-panel {\n    margin: -16px"), "Owner mobile panel must not use a negative margin on phones.");
assert(css.includes(".owner-mobile-panel") && css.includes("touch-action: pan-y;"), "Owner mobile panel should allow normal vertical touch scrolling.");
assert(css.includes(".admin-mobile-only") && css.includes("overflow: visible;"), "Mobile admin wrapper should not trap vertical scrolling.");
assert(css.includes(".admin-dashboard-shell") && css.includes("overflow-y: visible;"), "Admin dashboard shell should keep page-level vertical scrolling available.");
assert(css.includes(".owner-table-wrap") && css.includes("touch-action: pan-x pan-y;"), "Horizontal owner tables should not block vertical swipes.");

console.log("Mobile scroll safety check passed.");
