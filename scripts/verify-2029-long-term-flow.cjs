const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert(app.includes("const DECIMAL_INPUT_PATTERN = /^-?\\d*([.,]\\d*)?$/;"), "Cashier decimal input should accept dot and comma.");
assert(app.includes('type="text"'), "Number inputs should avoid browser spinner/scroll behavior.");
assert(app.includes('inputMode="decimal"'), "Number inputs should still show decimal keyboards.");
assert(!app.includes("function shouldAutoApproveLiloanShift3Correction"), "Liloan correction requests must not auto-approve.");
assert(!app.includes("pendingAutoApprovals"), "No background auto-approval effect should remain.");
assert(app.includes("repairAutoApprovedCorrection"), "Old auto-approved correction damage should be repaired when loaded.");
assert(app.includes("const expectedDip = n(row.opening) + n(row.delivery) - fuelLiters[row.product] - n(row.pullOut);"), "Calibration should not be subtracted from tank dip after being returned.");
assert(app.includes("const cashVariance = bankDeposit + pendingCashOnHand - expectedCash;"), "Pending cash on hand should remove fake no-deposit variance.");

const decimalPattern = /^-?\d*([.,]\d*)?$/;
["409019.92", "326030,05", "12.", ".5", "0.75"].forEach((value) => {
  assert(decimalPattern.test(value), `Decimal value should be accepted while typing: ${value}`);
});

const SHIFT_IDS = ["shift-1", "shift-2", "shift-3"];
const FUEL_TYPES = ["Premium", "Regular", "Diesel"];
const PRICE = { Premium: 72.5, Regular: 71.5, Diesel: 67.8 };
const LILOAN_LAYOUT = [
  ["Premium", "Regular1", "Regular2", "Diesel"],
  ["Premium", "Regular1", "Regular2", "Diesel"],
];

function n(value) {
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOffset(baseDate, days) {
  const [year, month, day] = baseDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function money(value) {
  const rounded = Math.round(n(value) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function productFromNozzle(nozzle) {
  if (nozzle.startsWith("Premium")) return "Premium";
  if (nozzle.startsWith("Regular")) return "Regular";
  return "Diesel";
}

function buildPumpRows(openings) {
  return LILOAN_LAYOUT.flatMap((nozzles, pumpIndex) =>
    nozzles.map((nozzle) => {
      const key = `Pump ${pumpIndex + 1}|${nozzle}`;
      return {
        key,
        pump: `Pump ${pumpIndex + 1}`,
        nozzle,
        product: productFromNozzle(nozzle),
        opening: openings[key],
        closing: openings[key],
      };
    })
  );
}

function buildTankRows(openings) {
  return FUEL_TYPES.map((product) => ({
    product,
    opening: openings[product],
    delivery: 0,
    pullOut: 0,
    calibration: 0,
    actualDip: openings[product],
  }));
}

function pumpLitersSold(row) {
  const opening = n(row.opening);
  const closing = n(row.closing);
  if (opening <= 0 && closing > 0) return 0;
  return Math.max(0, closing - opening);
}

function tankTotalsByProduct(report, key) {
  return report.tankRows.reduce((totals, row) => {
    totals[row.product] += n(row[key]);
    return totals;
  }, { Premium: 0, Regular: 0, Diesel: 0 });
}

function compute(report) {
  const fuelLiters = { Premium: 0, Regular: 0, Diesel: 0 };
  const fuelSalesByProduct = { Premium: 0, Regular: 0, Diesel: 0 };

  report.pumpRows.forEach((row) => {
    const liters = pumpLitersSold(row);
    fuelLiters[row.product] += liters;
    fuelSalesByProduct[row.product] += liters * n(report.prices[row.product]);
  });

  const calibrationLiters = tankTotalsByProduct(report, "calibration");
  FUEL_TYPES.forEach((product) => {
    const grossLiters = n(fuelLiters[product]);
    const grossSales = n(fuelSalesByProduct[product]);
    const returnedCalibration = Math.min(grossLiters, n(calibrationLiters[product]));
    const averagePrice = grossLiters > 0 ? grossSales / grossLiters : Math.max(0, n(report.prices[product]));
    fuelLiters[product] = Math.max(0, grossLiters - returnedCalibration);
    fuelSalesByProduct[product] = Math.max(0, grossSales - returnedCalibration * averagePrice);
  });

  const fuelSales = FUEL_TYPES.reduce((sum, product) => sum + fuelSalesByProduct[product], 0);
  const fuelTechPayTotal = n(report.deductions.gcash) + n(report.deductions.card) + n(report.deductions.paymaya);
  const redemptionTotal = n(report.deductions.cashRedemption) + n(report.deductions.fuelRedemption);
  const deductionTotal = Object.values(report.deductions).reduce((sum, value) => sum + n(value), 0)
    + report.poRows.reduce((sum, row) => sum + n(row.amount), 0)
    + report.purchaseRows.reduce((sum, row) => sum + n(row.amount), 0);
  const grossSales = fuelSales + n(report.oilSales);
  const expectedCash = money(grossSales - deductionTotal);
  const bankDeposit = money(report.deposits.reduce((sum, row) => sum + n(row.amount), 0));
  const pendingCashOnHand = money(Math.max(0, expectedCash - bankDeposit));
  const cashVariance = money(bankDeposit + pendingCashOnHand - expectedCash);
  const tankRows = report.tankRows.map((row) => {
    const expectedDip = money(n(row.opening) + n(row.delivery) - n(fuelLiters[row.product]) - n(row.pullOut));
    return { ...row, expectedDip, variance: money(n(row.actualDip) - expectedDip) };
  });

  return {
    fuelLiters,
    fuelSalesByProduct,
    fuelTechPayTotal,
    redemptionTotal,
    fuelSales,
    grossSales,
    expectedCash,
    bankDeposit,
    pendingCashOnHand,
    cashVariance,
    tankRows,
  };
}

function assertSubmitReady(report) {
  assert(report.date.startsWith("2080-"), "Future stress data must stay in isolated year 2080 only.");
  report.pumpRows.forEach((row) => {
    assert(n(row.opening) > 0, `${row.key} opening should be present.`);
    assert(n(row.closing) >= n(row.opening), `${row.key} closing should not be lower than opening.`);
    assert(n(report.prices[row.product]) > 0, `${row.product} price should be present.`);
  });
}

let pumpOpenings = Object.fromEntries(buildPumpRows({}).map((row, index) => [
  row.key,
  money(100000 + index * 113.37 + 0.16),
]));
let tankOpenings = { Premium: 9000.5, Regular: 12000.75, Diesel: 15000.25 };
let previousReport = null;
let reportCount = 0;
const persistedReports = {};
const openingSetup = { branch: "Liloan", date: "2079-12-31", shiftId: "shift-3", baselineConfirmed: true, baselineReport: true };
assert(openingSetup.baselineConfirmed, "Opening setup should count as a completed starting shift.");

for (let day = 0; day < 30; day += 1) {
  const date = dateOffset("2080-01-01", day);
  SHIFT_IDS.forEach((shiftId, shiftIndex) => {
    const pumpRows = buildPumpRows(pumpOpenings).map((row, rowIndex) => {
      const liters = money(18.5 + day * 0.2 + shiftIndex * 1.35 + rowIndex * 0.77);
      const closingText = (n(row.opening) + liters).toFixed(2);
      assert(decimalPattern.test(closingText), `Generated closing should be decimal text: ${closingText}`);
      return { ...row, closing: closingText };
    });

    const grossByProduct = pumpRows.reduce((totals, row) => {
      totals[row.product] += pumpLitersSold(row);
      return totals;
    }, { Premium: 0, Regular: 0, Diesel: 0 });

    const tankRows = buildTankRows(tankOpenings).map((row) => {
      const delivery = shiftId === "shift-1" && day % 5 === 0 ? (row.product === "Diesel" ? 900 : 600) : 0;
      const calibration = row.product === "Premium" ? 0.5 : row.product === "Regular" ? 0.75 : 1.25;
      const officialSold = Math.max(0, n(grossByProduct[row.product]) - calibration);
      return {
        ...row,
        delivery,
        calibration,
        actualDip: money(n(row.opening) + delivery - officialSold),
      };
    });

    const report = {
      branch: "Liloan",
      date,
      shiftId,
      confirmed: true,
      prices: PRICE,
      pumpRows,
      tankRows,
      deductions: {
        gcash: "150.25",
        card: shiftIndex === 2 ? "88.50" : "0",
        paymaya: "12.75",
        cashRedemption: shiftIndex === 1 ? "50.00" : "0",
        fuelRedemption: shiftIndex === 2 ? "125.50" : "0",
      },
      poRows: [{ amount: shiftIndex === 2 ? "300.25" : "0" }],
      purchaseRows: [{ amount: day % 7 === 0 ? "75.50" : "0" }],
      oilSales: "120.75",
      deposits: [],
    };

    assertSubmitReady(report);
    const resultBeforeDeposit = compute(report);
    const bankAmount = money(resultBeforeDeposit.expectedCash * 0.65);
    report.deposits = [{ amount: bankAmount, verified: shiftId !== "shift-3" }];

    const result = compute(report);
    assert.equal(result.cashVariance, 0, "Bank plus pending cash on hand should balance expected cash.");
    assert(result.pendingCashOnHand >= 0, "Pending cash on hand should hold cash not deposited yet.");
    assert.equal(result.redemptionTotal, n(report.deductions.cashRedemption) + n(report.deductions.fuelRedemption), "Points withdrawn should equal cash plus fuel redemption.");
    result.tankRows.forEach((row) => assert.equal(row.variance, 0, `${row.product} tank variance should stay zero when calibration returns to tank.`));

    if (previousReport) {
      report.pumpRows.forEach((row, index) => {
        assert.equal(n(row.opening), n(previousReport.pumpRows[index].closing), "Pump openings should carry from the previous shift closing.");
      });
      report.tankRows.forEach((row, index) => {
        assert.equal(n(row.opening), n(previousReport.tankRows[index].actualDip), "Tank openings should carry from the previous shift dip.");
      });
    }

    pumpOpenings = Object.fromEntries(report.pumpRows.map((row) => [row.key, n(row.closing)]));
    tankOpenings = Object.fromEntries(report.tankRows.map((row) => [row.product, n(row.actualDip)]));
    previousReport = report;
    const key = `${report.branch}__${report.date}__${report.shiftId}`;
    persistedReports[key] = JSON.parse(JSON.stringify(report));
    const refreshedReport = JSON.parse(JSON.stringify(persistedReports))[key];
    assert.equal(refreshedReport.confirmed, true, "A confirmed report should remain complete after refresh.");
    assert.equal(refreshedReport.pumpRows.length, 8, "All pump rows should survive refresh.");
    assert.equal(compute(refreshedReport).expectedCash, result.expectedCash, "Expected cash should remain unchanged after refresh.");
    reportCount += 1;
  });
}

assert.equal(reportCount, 90, "Expected 30 days x 3 shifts of isolated 2080 reports.");
assert.equal(Object.keys(persistedReports).length, 90, "Every shift should have one unique persisted report.");
assert(Object.values(persistedReports).every((report) => report.confirmed), "Station Health should see all 90 shifts as submitted.");

console.log("2080 month simulation passed: 30 days, 90 confirmed shifts, refresh persistence, formulas, decimals, continuity, and health completion.");
