import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("admin desktop and mobile use the secure logout action", () => {
  assert.match(source, /<AdminPage logout=\{logout\}/);
  assert.match(source, /<AdminControlStrip[\s\S]*?logout=\{logout\}/);
  assert.match(source, /<AdminMobilePerformance logout=\{logout\}/);
  assert.equal((source.match(/className="admin-logout-button" onClick=\{logout\}>Log Out<\/button>/g) || []).length, 2);
});
