const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createClient } = require("@supabase/supabase-js");

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !process.env[key]) process.env[key] = value;
  });
}

loadEnvFile(process.argv[2]);
loadEnvFile(path.join(__dirname, "..", ".env.production.local"));
loadEnvFile(path.join(__dirname, "..", ".env.live-test.local"));
loadEnvFile("C:\\Users\\fuelt\\Documents\\Fueltech Terminal\\.env.production.local");

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://chqinknijqtixeenhtvu.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

assert(serviceKey, "Missing Supabase service key for live CRUD verification.");

const supabase = createClient(supabaseUrl, serviceKey);
const runId = `codex-live-crud-${Date.now()}`;
const branch = "Liloan";
const shifts = ["shift-1", "shift-2", "shift-3"];
const prices = {
  Premium: 72.55,
  Regular: 71.45,
  Diesel: 67.85,
  PremiumCost: 70.1,
  RegularCost: 69.2,
  DieselCost: 65.8,
  __codexLiveTest: runId,
};

function dateOffset(baseDate, days) {
  const date = new Date(`${baseDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function reportKey(date, shiftId) {
  return `${branch}__${date}__${shiftId}`;
}

function productFromNozzle(nozzle) {
  if (nozzle.startsWith("Premium")) return "Premium";
  if (nozzle.startsWith("Regular")) return "Regular";
  return "Diesel";
}

function buildPumpRows(shiftIndex) {
  const layout = [
    ["Premium", "Regular1", "Regular2", "Diesel"],
    ["Premium", "Regular1", "Regular2", "Diesel"],
  ];
  return layout.flatMap((nozzles, pumpIndex) =>
    nozzles.map((nozzle, nozzleIndex) => {
      const opening = 480000 + pumpIndex * 1000 + nozzleIndex * 100 + shiftIndex * 20 + 0.25;
      return {
        id: `${runId}-pump-${pumpIndex}-${nozzleIndex}`,
        pump: `Pump ${pumpIndex + 1}`,
        nozzle,
        product: productFromNozzle(nozzle),
        opening,
        closing: Number((opening + 12.5 + nozzleIndex * 0.75).toFixed(2)),
      };
    })
  );
}

function buildTankRows(shiftIndex) {
  return [
    { tank: "Premium Tank", product: "Premium", opening: 8000.5, delivery: shiftIndex === 0 ? 500 : 0, pullOut: 0, calibration: 0.5, actualDip: 8475.5 },
    { tank: "Regular Tank", product: "Regular", opening: 9500.75, delivery: shiftIndex === 0 ? 500 : 0, pullOut: 0, calibration: 0.75, actualDip: 9969.25 },
    { tank: "Diesel Tank", product: "Diesel", opening: 12000.25, delivery: shiftIndex === 0 ? 900 : 0, pullOut: 0, calibration: 1.25, actualDip: 12880.25 },
  ].map((row, index) => ({ ...row, id: `${runId}-tank-${shiftIndex}-${index}` }));
}

async function assertNoError(response, label) {
  if (response.error) {
    throw new Error(`${label}: ${response.error.message}`);
  }
  return response.data;
}

async function findUnusedDate() {
  for (let offset = 0; offset < 365; offset += 1) {
    const date = dateOffset("2029-12-01", offset);
    const keys = shifts.map((shiftId) => reportKey(date, shiftId));
    const reports = await assertNoError(
      await supabase.from("fueltech_reports").select("report_key").in("report_key", keys),
      "checking existing report rows"
    );
    const priceRows = await assertNoError(
      await supabase
        .from("fueltech_price_book")
        .select("branch,effective_date,coverage,shift_id")
        .eq("branch", branch)
        .eq("effective_date", date)
        .eq("coverage", "Daily")
        .eq("shift_id", "daily"),
      "checking existing price rows"
    );
    if (!reports.length && !priceRows.length) return date;
  }
  throw new Error("Could not find an unused future 2029/2030 date for live CRUD test.");
}

async function cleanup(date) {
  const keys = shifts.map((shiftId) => reportKey(date, shiftId));
  await supabase.from("fueltech_reports").delete().in("report_key", keys);
  await supabase
    .from("fueltech_price_book")
    .delete()
    .eq("branch", branch)
    .eq("effective_date", date)
    .eq("coverage", "Daily")
    .eq("shift_id", "daily");
}

(async () => {
  const testDate = await findUnusedDate();
  const keys = shifts.map((shiftId) => reportKey(testDate, shiftId));

  try {
    await assertNoError(
      await supabase.from("fueltech_price_book").insert({
        branch,
        effective_date: testDate,
        coverage: "Daily",
        shift_id: "daily",
        prices,
        updated_at: new Date().toISOString(),
      }),
      "creating live test price row"
    );

    const reportRows = shifts.map((shiftId, shiftIndex) => ({
      report_key: reportKey(testDate, shiftId),
      branch,
      report_date: testDate,
      shift_id: shiftId,
      updated_at: new Date().toISOString(),
      data: {
        id: `${runId}-${shiftId}`,
        __codexLiveTest: runId,
        branch,
        date: testDate,
        shiftId,
        confirmed: true,
        confirmedAt: new Date().toISOString(),
        cashierName: "Codex live CRUD test",
        prices,
        pumpRows: buildPumpRows(shiftIndex),
        tankRows: buildTankRows(shiftIndex),
        deductions: {
          gcash: 101.25,
          card: 80.5,
          paymaya: 25.75,
          cashRedemption: 12.5,
          fuelRedemption: 18.75,
        },
        poRows: [{ id: `${runId}-po`, name: "Codex Test PO", amount: 45.5 }],
        purchaseRows: [{ id: `${runId}-pr`, name: "Codex Test PR", amount: 30.25 }],
        oilSales: 99.95,
        pointsIssued: 0,
        pointsWithdrawn: 31.25,
        coke: { beginning: 0, ending: 0, redemption: 0 },
        deposits: [{ id: `${runId}-deposit`, bank: "Codex Test Bank", reference: runId, amount: 1000.5, verified: false }],
        midShiftPriceChanges: [],
      },
    }));

    await assertNoError(
      await supabase.from("fueltech_reports").insert(reportRows),
      "creating live test report rows"
    );

    const insertedReports = await assertNoError(
      await supabase.from("fueltech_reports").select("report_key,data").in("report_key", keys),
      "reading inserted live test reports"
    );
    assert.equal(insertedReports.length, 3, "Live report readback should return three test shifts.");
    assert(insertedReports.every((row) => row.data?.__codexLiveTest === runId), "Live reports should contain the test marker.");

    const insertedPrices = await assertNoError(
      await supabase
        .from("fueltech_price_book")
        .select("prices")
        .eq("branch", branch)
        .eq("effective_date", testDate)
        .eq("coverage", "Daily")
        .eq("shift_id", "daily"),
      "reading inserted live test prices"
    );
    assert.equal(insertedPrices.length, 1, "Live price readback should return one test price row.");
    assert.equal(insertedPrices[0].prices?.__codexLiveTest, runId, "Live price row should contain the test marker.");

    await assertNoError(
      await supabase
        .from("fueltech_reports")
        .update({
          data: {
            ...insertedReports[0].data,
            cashierName: "Codex live CRUD test updated",
            __codexLiveTestUpdated: true,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("report_key", keys[0]),
      "updating live test report"
    );

    const updated = await assertNoError(
      await supabase.from("fueltech_reports").select("data").eq("report_key", keys[0]).maybeSingle(),
      "reading updated live test report"
    );
    assert.equal(updated.data?.cashierName, "Codex live CRUD test updated", "Live report update should persist.");

    await cleanup(testDate);

    const remainingReports = await assertNoError(
      await supabase.from("fueltech_reports").select("report_key").in("report_key", keys),
      "checking deleted live test reports"
    );
    const remainingPrices = await assertNoError(
      await supabase
        .from("fueltech_price_book")
        .select("branch")
        .eq("branch", branch)
        .eq("effective_date", testDate)
        .eq("coverage", "Daily")
        .eq("shift_id", "daily"),
      "checking deleted live test price"
    );
    assert.equal(remainingReports.length, 0, "Live test reports should be deleted after verification.");
    assert.equal(remainingPrices.length, 0, "Live test price row should be deleted after verification.");

    console.log(`Live Supabase CRUD check passed. Created, read, updated, and deleted 3 fake reports plus 1 fake price row for ${branch} ${testDate}.`);
  } catch (error) {
    await cleanup(testDate);
    throw error;
  }
})();
