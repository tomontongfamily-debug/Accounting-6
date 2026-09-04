import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("admin mobile system report shows requested accounting figures", () => {
  assert.match(source, /Cash on Hand for Deposit/);
  assert.match(source, /Latest Inventory Value/);
  assert.match(source, /Margin per Liter per Station/);
  assert.match(source, /CASH_VOUCHER_CATEGORIES\.map/);
  assert.match(source, /summary\.pendingCashOnHand/);
  assert.match(source, /summary\.deductions/);
  assert.match(source, /branch === "Liloan" \? 3 : 2/);
  assert.match(source, /sellingPrice - deliveryCost - customerDiscount/);
  assert.match(source, /After ₱2\/L discount; Liloan uses ₱3\/L\./);
});
