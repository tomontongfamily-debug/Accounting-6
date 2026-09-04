const fs = require("node:fs");
const assert = require("node:assert/strict");

const app = fs.readFileSync("src/App.jsx", "utf8");
const styles = fs.readFileSync("src/styles.css", "utf8");

assert.match(app, /ghostZero && value === 0 \? "" : value \?\? ""/);
assert.match(app, /placeholder=\{ghostZero \? "0" : placeholder\}/);
assert.match(app, /<NumberInput ghostZero className="pump-closing-input"/);
assert.match(app, /<NumberInput ghostZero value=\{row\.delivery\}/);
assert.match(app, /<NumberInput ghostZero value=\{row\.actualDip\}/);
assert.match(app, /<EditableList ghostZero title="PO Accounts"/);
assert.match(app, /<EditableList ghostZero title="Purchase Requests"/);
assert.match(app, /<NumberInput ghostZero value=\{report\.oilSales\}/);
assert.match(app, /<NumberInput ghostZero value=\{report\.actualCashCounted\}/);
assert.match(styles, /\.ghost-zero-input::placeholder/);

console.log("Cashier ghost-zero placeholder check passed.");
