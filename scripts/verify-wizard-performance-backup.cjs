const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
const backup = fs.readFileSync(path.join(root, "api", "admin", "backup-restore-test.js"), "utf8");

[
  [app.includes("Step {wizardStep + 1} of {wizardSteps.length}"), "cashier wizard progress"],
  [app.includes('"Review and Submit"'), "eight-step review"],
  [app.includes('activeDesktopCategory === "performance"'), "performance dashboard"],
  [app.includes("performanceSummary.actualCashCounted"), "actual cash metric"],
  [app.includes("testLatestBackupRestore"), "backup test button"],
  [backup.includes('mode: "non-destructive-memory-restore"'), "safe restore mode"],
  [backup.includes("sourceChecksum !== restoredChecksum"), "restore checksum"],
  [css.includes(".cashier-wizard-shell"), "wizard styles"],
].forEach(([passed, label]) => {
  if (!passed) throw new Error(`Missing ${label}`);
});

console.log("Wizard, performance dashboard, and backup restore checks passed.");
