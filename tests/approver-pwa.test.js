import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const manifest = JSON.parse(
  fs.readFileSync(new URL("../public/fueltech-approver-manifest-v1.webmanifest", import.meta.url), "utf8")
);
const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("approver has a dedicated installable mobile manifest", () => {
  assert.equal(manifest.id, "/approver");
  assert.equal(manifest.start_url, "/approver");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.short_name, "FuelTech Approver");
  assert.equal(manifest.icons.some((icon) => icon.sizes === "192x192" && icon.purpose.includes("maskable")), true);
  assert.equal(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose.includes("maskable")), true);
});

test("the approver URL selects its own manifest and mobile title", () => {
  assert.match(index, /"\/approver": "\/fueltech-approver-manifest-v1\.webmanifest"/);
  assert.match(index, /FuelTech Approver/);
});
