const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createClient } = require("@supabase/supabase-js");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index < 1 || line.trim().startsWith("#")) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(process.argv[3] || path.join(__dirname, "..", ".env.live-test.local"));
const baseUrl = process.argv[2] || "https://fueltechphil.vercel.app";
const branch = "Liloan", date = `2080-11-${String(10 + Math.floor(Math.random() * 15)).padStart(2, "0")}`, shiftId = "shift-1";
const reportKey = `${branch}__${date}__${shiftId}`, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pins = JSON.parse(process.env.FUELTECH_CASHIER_PINS_JSON || "{}");
assert(serviceKey && pins[branch], "Live test credentials are unavailable.");
const supabase = createClient(process.env.SUPABASE_URL || "https://chqinknijqtixeenhtvu.supabase.co", serviceKey);

async function post(route, body, sessionCookie = "") {
  const response = await fetch(`${baseUrl}${route}`, { method: "POST", headers: { "content-type": "application/json", ...(sessionCookie ? { cookie: sessionCookie } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => ({})), setCookie: response.headers.get("set-cookie") || "" };
}

function pumpRows() {
  const layout = [["Premium", "Regular1", "Regular2", "Diesel"], ["Premium", "Regular1", "Regular2", "Diesel"]];
  return layout.flatMap((nozzles, pumpIndex) => nozzles.map((nozzle, index) => ({ id: `live-${pumpIndex}-${index}`, pump: `Pump ${pumpIndex + 1}`, nozzle, product: nozzle.startsWith("Premium") ? "Premium" : nozzle.startsWith("Regular") ? "Regular" : "Diesel", opening: 100000 + pumpIndex * 1000 + index * 100, closing: 100012.5 + pumpIndex * 1000 + index * 100, closingEntered: true, closingEntrySource: "cashier" })));
}

(async () => {
  await supabase.from("fueltech_reports").delete().eq("report_key", reportKey);
  try {
    const unauthenticated = await post("/api/reports/save", { report: {} });
    assert.equal(unauthenticated.status, 401);
    const login = await post("/api/auth/verify", { role: "Cashier", branch, pin: pins[branch] });
    assert.equal(login.status, 200); assert(login.body.token); assert(login.setCookie.includes("__Host-fueltech_session="));
    const sessionCookie = login.setCookie.split(";")[0], clientA = `live-a-${Date.now()}`, clientB = `live-b-${Date.now()}`;
    const leaseA = await post("/api/reports/lease", { branch, date, shiftId, clientId: clientA, actor: "Live protection test" }, sessionCookie);
    assert.equal(leaseA.status, 200);
    const leaseB = await post("/api/reports/lease", { branch, date, shiftId, clientId: clientB, actor: "Second device" }, sessionCookie);
    assert.equal(leaseB.status, 409); assert.equal(leaseB.body.conflict, true);

    const report = { branch, date, shiftId, confirmed: false, baselineConfirmed: true, baselineReport: true, cashierName: "Live protection test", prices: { Premium: 72, Regular: 71, Diesel: 68 }, pumpConfigVersion: "2026-07-19-v1", pumpRows: pumpRows(), tankRows: ["Premium", "Regular", "Diesel"].map((product, index) => ({ id: `tank-${index}`, tank: `${product} Tank`, product, opening: 1000, delivery: 0, pullOut: 0, calibration: 0, actualDip: 990 })), deductions: { gcash: 0, card: 0, cashRedemption: 0, fuelRedemption: 0 }, poRows: [], purchaseRows: [], oilSales: 0, pointsIssued: 0, pointsWithdrawn: 0, coke: { beginning: 10, ending: 10 }, deposits: [], midShiftPriceChanges: [], actualCashCounted: 1000, clientSave: { clientId: clientA, version: 1, baseVersion: 0, mutationId: `${clientA}:1` } };
    const saved = await post("/api/reports/save", { report, operation: "save" }, sessionCookie);
    assert.equal(saved.status, 200); assert.equal(saved.body.version, 1);
    const submittedReport = { ...saved.body.report, clientSave: { clientId: clientA, version: 2, baseVersion: 1, mutationId: `${clientA}:2` } };
    const submitted = await post("/api/reports/save", { report: submittedReport, operation: "submit" }, sessionCookie);
    assert.equal(submitted.status, 200); assert(submitted.body.reportId); assert.equal(submitted.body.locked, true);
    const duplicate = await post("/api/reports/save", { report: submittedReport, operation: "submit" }, sessionCookie);
    assert.equal(duplicate.status, 200); assert.equal(duplicate.body.reportId, submitted.body.reportId); assert.equal(duplicate.body.duplicateIgnored, true);
    const locked = await post("/api/reports/save", { report: { ...submitted.body.report, clientSave: { clientId: clientA, version: 3, baseVersion: 2, mutationId: `${clientA}:3` } }, operation: "save" }, sessionCookie);
    assert.equal(locked.status, 423);
    const refreshed = await post("/api/store/load", {}, sessionCookie);
    const refreshedRow = refreshed.body.reportRows?.find((row) => row.report_key === reportKey);
    assert.equal(refreshed.status, 200); assert.equal(refreshedRow?.data?.confirmed, true); assert.equal(refreshedRow?.data?.serverMeta?.reportId, submitted.body.reportId);
    const loggedOut = await post("/api/auth/logout", {}, sessionCookie);
    assert.equal(loggedOut.status, 200); assert(loggedOut.setCookie.includes("Max-Age=0"));
    const afterLogout = await post("/api/store/load", {}, "");
    assert.equal(afterLogout.status, 401);
    console.log(`Live protections passed for ${reportKey}; report ID ${submitted.body.reportId}; refresh, conflict, duplicate retry, lock, and logout verified.`);
  } finally {
    const { error } = await supabase.from("fueltech_reports").delete().eq("report_key", reportKey);
    if (error) throw error;
    const { data } = await supabase.from("fueltech_reports").select("report_key").eq("report_key", reportKey);
    assert.equal(data.length, 0, "Live test report cleanup failed.");
    console.log("Live test data deleted.");
  }
})().catch((error) => { console.error(error); process.exit(1); });
