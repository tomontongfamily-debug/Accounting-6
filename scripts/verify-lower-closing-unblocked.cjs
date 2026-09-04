const fs = require("node:fs");
const assert = require("node:assert/strict");

const app = fs.readFileSync("src/App.jsx", "utf8");
const saveApi = fs.readFileSync("api/reports/save.js", "utf8");

assert.doesNotMatch(app, /closing pump reading is lower than opening/);
assert.doesNotMatch(app, /current closing is lower than previous closing/);
assert.doesNotMatch(saveApi, /current closing cannot be lower than previous closing/);
assert.match(app, /const sold = closing - opening/);
assert.match(app, /return sold < 0 \? sold : 0/);
assert.match(app, /<Card title="Pump Variance"/);

console.log("Lower closing cashier unblock with admin pump discrepancy check passed.");
