import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const realtimeSource = readFileSync(new URL("../src/realtime-store.js", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("../supabase/fueltech-realtime-signals.sql", import.meta.url), "utf8");
const vercelConfig = readFileSync(new URL("../vercel.json", import.meta.url), "utf8");

test("accounting store refreshes from Supabase change events instead of a timer", () => {
  assert.match(appSource, /subscribeToStoreChanges/);
  assert.doesNotMatch(appSource, /AUTO_REFRESH_MS/);
  assert.doesNotMatch(appSource, /setInterval\(\(\) => refreshOnlineStore/);
  assert.doesNotMatch(appSource, /setInterval\(\(\) => refreshCashierPrices/);
  assert.match(appSource, /window\.addEventListener\("focus", refreshWhenVisible\)/);
});

test("realtime listens only to the non-sensitive change signal table", () => {
  assert.match(realtimeSource, /table: "fueltech_realtime_signals"/);
  assert.match(realtimeSource, /event: "\*"/);
  assert.match(migrationSource, /grant select on public\.fueltech_realtime_signals to anon, authenticated/);
  assert.match(migrationSource, /revoke all on public\.fueltech_realtime_signals from anon, authenticated/);
  assert.doesNotMatch(migrationSource, /grant select on public\.fueltech_reports to anon/);
  assert.doesNotMatch(migrationSource, /grant select on public\.fueltech_price_book to anon/);
});

test("production CSP permits only the configured Supabase realtime endpoint", () => {
  assert.match(vercelConfig, /connect-src 'self' https:\/\/chqinknijqtixeenhtvu\.supabase\.co wss:\/\/chqinknijqtixeenhtvu\.supabase\.co/);
});
