const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(!app.includes('Field label="Coke Redemption"'), "Cashier should not show a Coke Redemption input.");
assert(app.includes("Coke Beginning"), "Cashier should still show Coke Beginning.");
assert(app.includes("Coke Ending"), "Cashier should still show Coke Ending.");
assert(app.includes('Field label="Coke Beginning"><b className="read-only-value">{report.coke.beginning}</b></Field>'), "Cashier Coke Beginning should be read-only after first opening.");
assert(app.includes('patchReport(["coke", "beginning"]'), "First Opening Setup should be the place to enter Coke Beginning.");
assert(app.includes("beginning: previousCokeEnding(previousReport)"), "Coke Beginning should carry forward from the previous shift ending.");
assert(app.includes('Card title="Coke Sold"'), "Existing Coke Sold wording should remain.");
assert(app.includes("n(report.coke.beginning) - n(report.coke.ending)"), "Coke calculation should use beginning minus ending.");
assert(!app.includes("- n(report.coke.redemption)"), "Coke calculation should not subtract redemption anymore.");

console.log("Coke redemption removal check passed.");
