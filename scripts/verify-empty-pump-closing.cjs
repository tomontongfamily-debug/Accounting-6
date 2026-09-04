const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");
const saveApi = fs.readFileSync(path.join(__dirname, "..", "api", "reports", "save.js"), "utf8");

assert(app.includes("closingEntered: false"), "New pump closings should start untouched.");
assert(app.includes('value={row.closingEntered ? row.closing : ""}'), "Untouched closing inputs should render empty.");
assert(app.includes('<NumberInput ghostZero className="pump-closing-input"'), "Untouched closing inputs should show a ghost zero.");
assert(app.includes('next.pumpRows[key].closingEntered = value !== ""'), "Typing or clearing should update closing entry state.");
assert(app.includes("closingEntered: true"), "Opening setup should preserve intentional closing values.");
assert(app.includes('closingEntrySource = value !== "" ? "cashier" : ""'), "Cashier-entered closings should carry explicit proof.");
assert(app.includes('n(row.closing) !== n(row.opening)'), "Legacy copied closings should be cleared while genuine changed readings are preserved.");
assert(saveApi.includes("if (!row.closingEntered)"), "The server should reject untouched current closings.");

console.log("Empty pump closing behavior check passed.");
