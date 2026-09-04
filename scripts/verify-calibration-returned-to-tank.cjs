const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(app.includes('const calibrationLiters = tankTotalsByProduct(report, "calibration");'), "Compute should read calibration liters by product.");
assert(app.includes("const returnedCalibration = Math.min(grossLiters, n(calibrationLiters[product]));"), "Calibration liters should be capped to pump liters.");
assert(app.includes("fuelLiters[product] = Math.max(0, grossLiters - returnedCalibration);"), "Calibration should reduce official sold liters.");
assert(app.includes("fuelSalesByProduct[product] = Math.max(0, grossSales - returnedCalibration * averagePrice);"), "Calibration should reduce fuel sales.");
assert(app.includes("const expectedDip = n(row.opening) + n(row.delivery) - fuelLiters[row.product] - n(row.pullOut);"), "Calibration should not be subtracted from tank reference after it is returned.");
assert(!app.includes("- n(row.pullOut) - n(row.calibration)"), "Old tank formula must not subtract calibration from the tank.");
assert(app.includes("return n(result.fuelSalesByProduct?.[product]);"), "Product sales export should use calibrated fuel sales.");

console.log("Calibration returned-to-tank check passed.");
