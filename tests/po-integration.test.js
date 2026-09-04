import test from "node:test";
import assert from "node:assert/strict";
import { authoritativePoRowsForReport, PO_INTEGRATION_START_DATE } from "../api/_shared/po.js";

test("historical PO rows remain unchanged before the integration date", async () => {
  const historical = [{ id: "old", account: "Historical account", amount: 123 }];
  const rows = await authoritativePoRowsForReport({}, { date: "2026-08-18", poRows: historical });
  assert.deepEqual(rows, historical);
  assert.equal(PO_INTEGRATION_START_DATE, "2026-08-19");
});

test("new reports receive posted PO transactions only", async () => {
  const query = {
    select() { return this; }, eq() { return this; }, order: async () => ({ data: [{ id: "tx-1", transaction_number: "FTPO-1", customer_name: "ABC", vehicle_name: "Truck", plate_number: "ABC-123", driver_name: "Juan", fuel_type: "Diesel", liters: 10, amount: 500, email_status: "SENT", transaction_at: "2026-08-19T01:00:00Z" }], error: null }),
  };
  const supabase = { from: () => query };
  const rows = await authoritativePoRowsForReport(supabase, { branch: "Liloan", date: "2026-08-19", shiftId: "shift-1", poRows: [{ id: "manual", amount: 999 }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "tx-1");
  assert.equal(rows[0].amount, 500);
  assert.equal(rows[0].source, "FuelTech Pay");
});
