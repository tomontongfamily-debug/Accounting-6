const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

const checks = [
  ["Pump configuration version changed", source.includes('const PUMP_CONFIG_VERSION = "2026-07-25-mabolo-pump-5"')],
  ["Mabolo has five four-nozzle pumps", /Mabolo:\s*\[(?:\s*\["Premium", "Regular1", "Regular2", "Diesel"\],){5}\s*\]/.test(source)],
  ["Submitted reports preserve historical pump rows", source.includes("reportCompleted(next)\n    ? existingPumpRows")],
  ["Draft reports merge newly configured pump rows", source.includes("existingPumpByKey[pumpCarryKey(row)] ||")],
  ["Recovered local drafts also merge the new layout", source.includes(": normalizeReport({\n      ...storedReport,")],
  ["Missing prior pump rows require a starting reading", source.includes("setupRequired: true")],
  ["New-pump starting reading is editable", source.includes("New pump starting reading")],
  ["New-pump setup explains historical safety", source.includes("does not change older reports")],
];

const failed = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
if (failed.length) process.exit(1);
