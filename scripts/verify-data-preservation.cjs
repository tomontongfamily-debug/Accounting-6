const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(js|jsx|sql)$/.test(entry.name) ? [target] : [];
  });
}

const approvedDiagnosticCleanup = path.normalize(path.join(root, "api", "admin", "diagnostic-save-check.js"));
for (const file of sourceFiles(path.join(root, "api"))) {
  const source = fs.readFileSync(file, "utf8");
    if (path.normalize(file) !== approvedDiagnosticCleanup) {
    assert.doesNotMatch(
      source,
      /\.from\(\s*["']fueltech_(?:reports|price_book)["']\s*\)[\s\S]{0,160}?\.delete\(/,
      `Production accounting deletion is forbidden: ${path.relative(root, file)}`
    );
  }
  assert.doesNotMatch(source, /\btruncate\s+(?:table\s+)?(?:public\.)?fueltech_/i);
  assert.doesNotMatch(source, /\bdrop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?fueltech_/i);
}

assert.match(app, /const REPORT_HISTORY_RESET_AT = "2026-07-30T06:20:49\.061Z"/);
assert.match(app, /const PRICE_HISTORY_RESET_AT = "2026-07-30T06:20:49\.061Z"/);
assert.doesNotMatch(app, /Redo (?:the )?Liloan (?:July 20, 2026 Shift 3 )?Opening Setup/i);
assert.ok(vercel.crons.some((cron) => cron.path === "/api/cron/nightly-backup"));

console.log("Live accounting data preservation gate passed.");
