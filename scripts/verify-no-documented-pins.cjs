const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const files = ["README.md", "BUILD_CHECK.txt"].map((file) => ({
  file,
  source: fs.readFileSync(path.join(__dirname, "..", file), "utf8"),
}));

for (const { file, source } of files) {
  assert(!source.includes("fueltechphils2026"), `${file} should not contain the admin PIN.`);
  assert(!source.match(/\b(110[1-6]|210[1-6])\b/), `${file} should not contain branch PINs.`);
}

console.log("No documented PINs check passed.");
