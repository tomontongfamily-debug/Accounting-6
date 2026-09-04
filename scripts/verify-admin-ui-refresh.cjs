const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "src", "styles.css"), "utf8");

assert(app.includes("admin-desktop-shell"), "Desktop admin should use a categorized shell layout.");
assert(app.includes("admin-desktop-rail"), "Desktop admin should include a left category rail.");
assert(app.includes("admin-section-overview"), "Desktop admin sections should have category anchors.");
assert(app.includes("admin-dashboard-shell"), "Logged-in admin should use a dedicated full-screen dashboard shell.");
assert(app.includes("admin-control-strip"), "Admin branch/date/shift/refresh controls should live inside the admin dashboard.");
assert(app.includes("showAppHero"), "The old hero should be hidden for logged-in admin.");
assert(app.includes("activeDesktopCategory"), "Desktop admin should switch between one visible category at a time.");
assert(app.includes("setActiveDesktopCategory(category.id)"), "Desktop admin category buttons should update local category state.");
assert(!app.includes("href=\"#admin-section-overview\""), "Desktop admin should not use anchor scrolling for category navigation.");
assert(app.includes("MobileStationHealthMatrix"), "Mobile reports should show station shift health matrix.");
assert(app.includes("healthRows={healthRows}"), "Mobile admin should receive station health rows.");
assert(app.includes("mobile-deposit-actions"), "Mobile admin deposits should include action controls.");
assert(app.includes("verifyDeposit(deposit.id, depositReport)"), "Mobile admin should be able to verify bank deposits.");
assert(app.includes("approveDepositRemoval(deposit.id, depositReport)"), "Mobile admin should be able to approve deposit removals.");
assert(app.includes("rejectDepositRemoval(deposit.id, depositReport)"), "Mobile admin should be able to reject deposit removals.");
assert(app.includes("MobileDepositApprovalList"), "Mobile admin should render a dedicated bank approval list.");
assert(css.includes(".admin-desktop-shell"), "Desktop categorized shell styles should exist.");
assert(css.includes(".admin-desktop-rail"), "Desktop left category rail styles should exist.");
assert(css.includes(".admin-desktop-content"), "Desktop admin content spacing styles should exist.");
assert(css.includes(".admin-dashboard-shell"), "Admin full-screen dashboard shell styles should exist.");
assert(css.includes(".admin-control-strip"), "Admin integrated filter controls should be styled.");
assert(css.includes(".admin-desktop-rail button.active"), "Desktop active category button should be styled.");
assert(css.includes(".mobile-health-matrix"), "Mobile reports matrix styles should exist.");
assert(css.includes("@media (max-width: 760px)") && css.includes(".app.admin-app"), "Mobile admin should use full-screen app styling.");
assert(css.includes(".mobile-admin-panel::before"), "Mobile admin should have a dark app-style visual background.");
assert(css.includes(".mobile-deposit-card"), "Mobile bank approval card styles should exist.");
assert(css.includes(".mobile-admin-action-row"), "Mobile action row styles should exist.");
assert(css.includes("backdrop-filter"), "Glass dashboard styling should use backdrop filtering where supported.");

console.log("Admin UI refresh check passed.");
