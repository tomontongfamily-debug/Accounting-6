const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

const numberInputStart = app.indexOf("function NumberInput");
assert(numberInputStart >= 0, "NumberInput should exist.");
const numberInputEnd = app.indexOf("function SelectInput", numberInputStart);
const numberInput = app.slice(numberInputStart, numberInputEnd);

assert(numberInput.includes('type="text"'), "NumberInput should use text input to avoid browser number scroll changes.");
assert(numberInput.includes('inputMode="decimal"'), "NumberInput should still show a numeric keyboard on mobile.");
assert(numberInput.includes("onWheel"), "NumberInput should guard against wheel changes.");
assert(!numberInput.includes('type="number"'), "NumberInput should not use scrollable browser number controls.");

console.log("Number input no-scroll check passed.");
