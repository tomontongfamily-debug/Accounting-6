const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "src", "styles.css"), "utf8");

assert(app.includes("const isAdminLogin = role === \"Admin\" && !accessAllowed;"), "App should detect admin login before access.");
assert(app.includes("admin-login-app"), "Admin login should have a mobile-specific app class.");
assert(app.includes("FuelTech Accounting"), "Admin mobile login should keep a readable brand title.");
assert(app.includes("admin-login-screen"), "Admin mobile login should use a dedicated screen, not the old section card.");
assert(app.includes("admin-login-form"), "Admin mobile login should use a dedicated form area.");
assert(app.includes("Open Dashboard"), "Admin mobile login action should be clear.");
assert(css.includes(".app.admin-login-app .hero") && css.includes("display: none;"), "Mobile admin login should hide branch/date/shift/refresh hero controls.");
assert(css.includes(".app.admin-login-app .container") && css.includes("align-content: stretch;"), "Mobile admin login should use the full page.");
assert(css.includes(".app.admin-login-app") && css.includes("height: 100dvh;") && css.includes("overflow: hidden;"), "Mobile admin login should fit one screen without page scrolling.");
assert(css.includes(".admin-login-form input") && css.includes("min-height: 58px;"), "Mobile admin login PIN field should be easy to read and tap.");
assert(css.includes("background: #020617;"), "Mobile admin login should use a dark luxury full-page background.");
assert(css.includes(".admin-login-screen") && css.includes("grid-template-rows: 1fr auto;"), "Mobile admin login should use the whole screen, not a small centered card.");
assert(css.includes(".admin-login-form") && css.includes("backdrop-filter: blur(18px);"), "Mobile admin login form should have a polished dark surface.");

console.log("Mobile admin login check passed.");
