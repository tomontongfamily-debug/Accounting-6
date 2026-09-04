const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const index = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const vercel = fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8");

const roleManifests = [
  {
    route: "/admin",
    file: "fueltech-admin-manifest-v1.webmanifest",
    shortName: "FuelTech Admin",
  },
  {
    route: "/approver",
    file: "fueltech-approver-manifest-v1.webmanifest",
    shortName: "FuelTech Approver",
  },
  {
    route: "/manager",
    file: "fueltech-manager-manifest-v1.webmanifest",
    shortName: "FuelTech Manager",
  },
  {
    route: "/cashier",
    file: "fueltech-cashier-manifest-v1.webmanifest",
    shortName: "FuelTech Cashier",
  },
];

for (const roleManifest of roleManifests) {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", roleManifest.file), "utf8"));
  assert(index.includes(`"${roleManifest.route}": "/${roleManifest.file}"`), `${roleManifest.route} should use its role manifest.`);
  assert.equal(manifest.start_url, roleManifest.route, `${roleManifest.shortName} shortcut should start at ${roleManifest.route}.`);
  assert.equal(manifest.short_name, roleManifest.shortName, `${roleManifest.route} manifest should have a distinct name.`);
  assert(vercel.includes(`/${roleManifest.file}`), `${roleManifest.shortName} manifest should be served no-cache.`);
}

console.log("Role home-screen manifest checks passed.");
