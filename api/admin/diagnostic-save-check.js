import assert from "node:assert/strict";
import { BRANCHES, SHIFT_IDS, readBody, supabaseAdmin } from "../_shared/supabase.js";
import { getRequestSession } from "../_shared/session.js";

const TEST_BRANCH = "Liloan";
const TEST_SHIFTS = ["shift-1", "shift-2", "shift-3"];

function dateOffset(baseDate, days) {
  const date = new Date(`${baseDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function reportKey(branch, date, shiftId) {
  return `${branch}__${date}__${shiftId}`;
}

function productFromNozzle(nozzle) {
  if (nozzle.startsWith("Premium")) return "Premium";
  if (nozzle.startsWith("Regular")) return "Regular";
  return "Diesel";
}

function buildPumpRows(runId, shiftIndex) {
  const layout = [
    ["Premium", "Regular1", "Regular2", "Diesel"],
    ["Premium", "Regular1", "Regular2", "Diesel"],
  ];
  return layout.flatMap((nozzles, pumpIndex) =>
    nozzles.map((nozzle, nozzleIndex) => {
      const opening = 480000 + pumpIndex * 1000 + nozzleIndex * 100 + shiftIndex * 20 + 0.25;
      return {
        id: `${runId}-pump-${shiftIndex}-${pumpIndex}-${nozzleIndex}`,
        pump: `Pump ${pumpIndex + 1}`,
        nozzle,
        product: productFromNozzle(nozzle),
        opening,
        closing: Number((opening + 12.5 + nozzleIndex * 0.75).toFixed(2)),
      };
    })
  );
}

function buildTankRows(runId, shiftIndex) {
  return [
    { tank: "Premium Tank", product: "Premium", opening: 8000.5, delivery: shiftIndex === 0 ? 500 : 0, pullOut: 0, calibration: 0.5, actualDip: 8475.5 },
    { tank: "Regular Tank", product: "Regular", opening: 9500.75, delivery: shiftIndex === 0 ? 500 : 0, pullOut: 0, calibration: 0.75, actualDip: 9969.25 },
    { tank: "Diesel Tank", product: "Diesel", opening: 12000.25, delivery: shiftIndex === 0 ? 900 : 0, pullOut: 0, calibration: 1.25, actualDip: 12880.25 },
  ].map((row, index) => ({ ...row, id: `${runId}-tank-${shiftIndex}-${index}` }));
}

async function assertNoError(query, label) {
  const response = await query;
  if (response.error) throw new Error(`${label}: ${response.error.message}`);
  return response.data;
}

async function findUnusedDate(supabase, branch) {
  for (let offset = 0; offset < 365; offset += 1) {
    const date = dateOffset("2030-01-01", offset);
    const keys = TEST_SHIFTS.map((shiftId) => reportKey(branch, date, shiftId));
    const reports = await assertNoError(
      supabase.from("fueltech_reports").select("report_key").in("report_key", keys),
      "checking future test report rows"
    );
    const prices = await assertNoError(
      supabase
        .from("fueltech_price_book")
        .select("branch")
        .eq("branch", branch)
        .eq("effective_date", date)
        .eq("coverage", "Daily")
        .eq("shift_id", "daily"),
      "checking future test price rows"
    );
    if (!reports.length && !prices.length) return date;
  }
  throw new Error("No unused 2030 diagnostic date was available.");
}

async function cleanup(supabase, branch, date, runId) {
  const keys = TEST_SHIFTS.map((shiftId) => reportKey(branch, date, shiftId));
  const reportRows = await assertNoError(
    supabase.from("fueltech_reports").select("report_key,data").in("report_key", keys),
    "checking diagnostic reports before cleanup"
  );
  const unsafeReports = reportRows.filter((row) => row.data?.__fueltechDiagnostic?.runId !== runId);
  if (unsafeReports.length) throw new Error("Cleanup stopped because a non-diagnostic report was found.");

  const priceRows = await assertNoError(
    supabase
      .from("fueltech_price_book")
      .select("prices")
      .eq("branch", branch)
      .eq("effective_date", date)
      .eq("coverage", "Daily")
      .eq("shift_id", "daily"),
    "checking diagnostic price before cleanup"
  );
  const unsafePrices = priceRows.filter((row) => row.prices?.__fueltechDiagnostic?.runId !== runId);
  if (unsafePrices.length) throw new Error("Cleanup stopped because a non-diagnostic price row was found.");

  if (reportRows.length) {
    await assertNoError(supabase.from("fueltech_reports").delete().in("report_key", keys), "deleting diagnostic reports");
  }
  if (priceRows.length) {
    await assertNoError(
      supabase
        .from("fueltech_price_book")
        .delete()
        .eq("branch", branch)
        .eq("effective_date", date)
        .eq("coverage", "Daily")
        .eq("shift_id", "daily"),
      "deleting diagnostic price"
    );
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const auth = getRequestSession(req);
    if (!auth.ok || auth.session.role !== "Admin") {
      res.status(403).json({ ok: false, error: "Admin login is required for diagnostic save check." });
      return;
    }

    const body = readBody(req);
    const branch = BRANCHES.includes(body.branch) ? body.branch : TEST_BRANCH;
    const supabase = supabaseAdmin();
    const runId = `fueltech-diagnostic-${Date.now()}`;
    const testDate = await findUnusedDate(supabase, branch);
    const keys = TEST_SHIFTS.map((shiftId) => reportKey(branch, testDate, shiftId));
    const prices = {
      Premium: 72.55,
      Regular: 71.45,
      Diesel: 67.85,
      PremiumCost: 70.1,
      RegularCost: 69.2,
      DieselCost: 65.8,
      __fueltechDiagnostic: { runId, createdAt: new Date().toISOString() },
    };

    try {
      await assertNoError(
        supabase.from("fueltech_price_book").insert({
          branch,
          effective_date: testDate,
          coverage: "Daily",
          shift_id: "daily",
          prices,
          updated_at: new Date().toISOString(),
        }),
        "creating diagnostic price"
      );

      const reportRows = TEST_SHIFTS.map((shiftId, shiftIndex) => ({
        report_key: reportKey(branch, testDate, shiftId),
        branch,
        report_date: testDate,
        shift_id: shiftId,
        updated_at: new Date().toISOString(),
        data: {
          id: `${runId}-${shiftId}`,
          __fueltechDiagnostic: { runId, createdAt: new Date().toISOString() },
          branch,
          date: testDate,
          shiftId,
          confirmed: true,
          confirmedAt: new Date().toISOString(),
          cashierName: "FuelTech diagnostic save check",
          prices,
          pumpRows: buildPumpRows(runId, shiftIndex),
          tankRows: buildTankRows(runId, shiftIndex),
          deductions: {
            gcash: 101.25,
            card: 80.5,
            paymaya: 25.75,
            cashRedemption: 12.5,
            fuelRedemption: 18.75,
          },
          poRows: [{ id: `${runId}-po`, name: "Diagnostic PO", amount: 45.5 }],
          purchaseRows: [{ id: `${runId}-pr`, category: "OPEX", item: "Diagnostic cash voucher", amount: 30.25 }],
          oilSales: 99.95,
          pointsIssued: 0,
          pointsWithdrawn: 31.25,
          coke: { beginning: 0, ending: 0, redemption: 0 },
          actualCashCount: 1000.5,
          deposits: [{ id: `${runId}-deposit`, bank: "Diagnostic Bank", reference: runId, amount: 1000.5, verified: false }],
          midShiftPriceChanges: [],
        },
      }));

      await assertNoError(supabase.from("fueltech_reports").insert(reportRows), "creating diagnostic reports");

      const insertedReports = await assertNoError(
        supabase.from("fueltech_reports").select("report_key,data").in("report_key", keys),
        "reading diagnostic reports"
      );
      assert.equal(insertedReports.length, 3, "Expected 3 diagnostic report rows.");
      assert(insertedReports.every((row) => row.data?.__fueltechDiagnostic?.runId === runId), "Diagnostic report marker was missing.");

      const insertedPrices = await assertNoError(
        supabase
          .from("fueltech_price_book")
          .select("prices")
          .eq("branch", branch)
          .eq("effective_date", testDate)
          .eq("coverage", "Daily")
          .eq("shift_id", "daily"),
        "reading diagnostic price"
      );
      assert.equal(insertedPrices.length, 1, "Expected 1 diagnostic price row.");
      assert.equal(insertedPrices[0].prices?.__fueltechDiagnostic?.runId, runId, "Diagnostic price marker was missing.");

      await assertNoError(
        supabase
          .from("fueltech_reports")
          .update({
            data: {
              ...insertedReports[0].data,
              cashierName: "FuelTech diagnostic save check updated",
              __fueltechDiagnosticUpdated: true,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("report_key", keys[0]),
        "updating diagnostic report"
      );

      const updated = await assertNoError(
        supabase.from("fueltech_reports").select("data").eq("report_key", keys[0]).maybeSingle(),
        "reading updated diagnostic report"
      );
      assert.equal(updated.data?.cashierName, "FuelTech diagnostic save check updated", "Diagnostic update did not persist.");

      await cleanup(supabase, branch, testDate, runId);

      const remainingReports = await assertNoError(
        supabase.from("fueltech_reports").select("report_key").in("report_key", keys),
        "checking diagnostic report cleanup"
      );
      const remainingPrices = await assertNoError(
        supabase
          .from("fueltech_price_book")
          .select("branch")
          .eq("branch", branch)
          .eq("effective_date", testDate)
          .eq("coverage", "Daily")
          .eq("shift_id", "daily"),
        "checking diagnostic price cleanup"
      );
      assert.equal(remainingReports.length, 0, "Diagnostic reports were not fully deleted.");
      assert.equal(remainingPrices.length, 0, "Diagnostic price was not fully deleted.");

      res.status(200).json({
        ok: true,
        message: "Diagnostic save check passed. Fake future data was created, verified, updated, deleted, and checked clean.",
        branch,
        testDate,
        reportRowsCreated: 3,
        priceRowsCreated: 1,
        reportRowsRemaining: 0,
        priceRowsRemaining: 0,
      });
    } catch (error) {
      await cleanup(supabase, branch, testDate, runId);
      throw error;
    }
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Diagnostic save check failed." });
  }
}
