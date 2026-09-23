import test from "node:test";
import assert from "node:assert/strict";
import { buildOwnerSmsSummary, effectiveSellingPrices, formatOwnerSms, normalizePhilippineMobile, previousOwnerSmsDate, sendUniSms } from "../api/_shared/owner-sms.js";

const branches = ["Mabolo", "Arpili", "Liloan", "Pondol", "Barili", "Moalboal"];

function reportRow(branch, {
  date = "2026-09-01",
  shiftId = "shift-1",
  liters = 100,
  price = 70,
  confirmed = true,
  deposit = 0,
} = {}) {
  return {
    branch,
    report_date: date,
    shift_id: shiftId,
    updated_at: `${date}T12:00:00Z`,
    data: {
      confirmed,
      oilSales: 0,
      pumpRows: [{
        id: `${branch}-${date}-${shiftId}-premium`,
        pump: "Pump 1",
        nozzle: "Premium",
        product: "Premium",
        opening: 10000,
        closing: 10000 + liters,
      }],
      prices: { Premium: price, Regular: price - 1, Diesel: price - 2 },
      tankRows: [{ product: "Premium", calibration: 0 }],
      deductions: {},
      poRows: [],
      purchaseRows: [],
      deposits: deposit > 0 ? [{ amount: deposit }] : [],
    },
  };
}

function threeShiftRows(branch, options = {}) {
  return [
    reportRow(branch, { ...options, date: "2026-08-31", shiftId: "shift-2" }),
    reportRow(branch, { ...options, date: "2026-08-31", shiftId: "shift-3" }),
    reportRow(branch, { ...options, date: "2026-09-01", shiftId: "shift-1" }),
  ];
}

test("builds station tank value and COH from yesterday shift 2, yesterday shift 3, and today shift 1", () => {
  const rows = branches.flatMap((branch) => threeShiftRows(branch));
  const summary = buildOwnerSmsSummary({
    reportRows: rows,
    currentDate: "2026-09-01",
  });
  assert.equal(summary.submittedReportCount, 6);
  assert.equal(summary.previousDate, "2026-08-31");
  assert.deepEqual(summary.stationRows.map((row) => row.branch), ["Mabolo", "Liloan", "Arpili", "Pondol", "Barili", "Moalboal"]);
  assert.equal(summary.stationRows[0].tankValue, 20400);
  assert.equal(summary.stationRows[1].tankValue, 20100);
  assert.equal(summary.stationRows[0].cashOnHand, 21000);
  assert.equal(summary.totalTankWorth, 122100);
  assert.equal(summary.totalCashOnHand, 126000);
  assert.equal(formatOwnerSms(summary), [
    "Good afternoon",
    "",
    "Tank Total Value",
    "Mabolo- 20,400.00",
    "Liloan- 20,100.00",
    "Arpili- 20,400.00",
    "Pondol- 20,400.00",
    "Barili- 20,400.00",
    "Moalboal- 20,400.00",
    "Grand total - 122,100.00",
    "",
    "COH shift 2 yesterday, shift 3 yesterday, shift 1 today",
    "Mabolo- 21,000",
    "Liloan- 21,000",
    "Arpili- 21,000",
    "Pondol- 21,000",
    "Barili- 21,000",
    "Moalboal- 21,000",
    "Grand total = 126,000",
    "Salamat",
  ].join("\n"));
});

test("totals only confirmed reports inside the exact three-shift owner period", () => {
  const rows = [
    ...threeShiftRows("Mabolo", { liters: 100 }),
    reportRow("Liloan", { date: "2026-08-31", shiftId: "shift-2", liters: 100 }),
    reportRow("Liloan", { date: "2026-08-31", shiftId: "shift-3", liters: 100, confirmed: false }),
    reportRow("Liloan", { date: "2026-09-01", shiftId: "shift-1", liters: 100 }),
    reportRow("Mabolo", { date: "2026-08-31", shiftId: "shift-1", liters: 900 }),
    reportRow("Mabolo", { date: "2026-08-30", shiftId: "shift-3", liters: 900 }),
  ];
  const summary = buildOwnerSmsSummary({
    reportRows: rows,
    currentDate: "2026-09-01",
  });
  assert.equal(summary.stationRows[0].reportCount, 3);
  assert.equal(summary.stationRows[0].tankValue, 20400);
  assert.equal(summary.stationRows[1].reportCount, 2);
  assert.equal(summary.stationRows[1].tankValue, 13400);
  assert.deepEqual(summary.missingBranches, ["Arpili", "Pondol", "Barili", "Moalboal"]);
});

test("adds one missing station as a simple final SMS line", () => {
  const summary = buildOwnerSmsSummary({
    reportRows: branches.slice(1).flatMap((branch) => threeShiftRows(branch)),
    currentDate: "2026-09-01",
  });

  assert.deepEqual(formatOwnerSms(summary).split("\n").slice(-2), ["Mabolo not sent", "Salamat"]);
});

test("does not add a missing-station line when every station submitted", () => {
  const summary = buildOwnerSmsSummary({
    reportRows: branches.flatMap((branch) => threeShiftRows(branch)),
    currentDate: "2026-09-01",
  });

  assert.equal(formatOwnerSms(summary).includes("not sent"), false);
  assert.equal(formatOwnerSms(summary).split("\n").at(-1), "Salamat");
});

test("uses a three-peso per liter discount only for Liloan", () => {
  const summary = buildOwnerSmsSummary({
    reportRows: [
      ...threeShiftRows("Mabolo", { liters: 10, price: 70 }),
      ...threeShiftRows("Liloan", { liters: 10, price: 70 }),
    ],
    currentDate: "2026-09-01",
  });
  assert.equal(summary.stationRows.find((row) => row.branch === "Mabolo").tankValue, 2040);
  assert.equal(summary.stationRows.find((row) => row.branch === "Liloan").tankValue, 2010);
});

test("calculates the previous owner SMS date across month boundaries", () => {
  assert.equal(previousOwnerSmsDate("2026-09-01"), "2026-08-31");
});

test("daily and exact shift prices are applied in the same order as the dashboard", () => {
  const rows = [
    { branch: "Mabolo", effective_date: "2026-08-19", coverage: "Daily", shift_id: "daily", prices: { Premium: 70, Regular: 69 } },
    { branch: "Mabolo", effective_date: "2026-08-20", coverage: "Shift", shift_id: "shift-1", prices: { Premium: 72 } },
  ];
  assert.deepEqual(effectiveSellingPrices(rows, "Mabolo", "2026-08-20", "shift-1", { Diesel: 68 }), {
    Premium: 72,
    Regular: 69,
    Diesel: 68,
  });
});

test("sends one authenticated UniSMS request", async () => {
  let request;
  const result = await sendUniSms({
    apiKey: "secret",
    recipient: "+639171234567",
    senderId: "Unisoft",
    content: "FUELTECH TEST",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ message: { reference_id: "msg_123", status: "sent" } }) };
    },
  });
  assert.equal(request.url, "https://unismsapi.com/api/sms");
  assert.equal(request.options.headers.Authorization, `Basic ${Buffer.from("secret:").toString("base64")}`);
  assert.deepEqual(JSON.parse(request.options.body), {
    recipient: "+639171234567",
    content: "FUELTECH TEST",
    sender_id: "Unisoft",
    metadata: { source: "fueltech_daily_owner_summary" },
  });
  assert.deepEqual(result, { referenceId: "msg_123", status: "sent", recipientCount: 1 });
});

test("normalizes Philippine mobile numbers and sends both owners as one blast", async () => {
  assert.equal(normalizePhilippineMobile("0977 808 8883"), "+639778088883");
  assert.equal(normalizePhilippineMobile("+63 999 998 8880"), "+639999988880");
  let request;
  const result = await sendUniSms({
    apiKey: "secret",
    recipients: ["09778088883", "09999988880"],
    senderId: "Unisoft",
    content: "FUELTECH TEST",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ blast_id: "blast_123", total: 2 }) };
    },
  });
  assert.equal(request.url, "https://unismsapi.com/api/blast");
  assert.deepEqual(JSON.parse(request.options.body).recipients, ["+639778088883", "+639999988880"]);
  assert.deepEqual(result, { referenceId: "blast_123", status: "queued", recipientCount: 2 });
});

test("sends a detailed long report in one complete provider request", async () => {
  const requests = [];
  const content = "D".repeat(600);
  const result = await sendUniSms({
    apiKey: "secret",
    recipients: ["09778088883", "09999988880"],
    senderId: "Unisoft",
    content,
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({ blast_id: "blast_1" }),
      };
    },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://unismsapi.com/api/blast");
  assert.deepEqual(requests[0].body.recipients, ["+639778088883", "+639999988880"]);
  assert.equal(requests[0].body.content, content);
  assert.deepEqual(result, {
    referenceId: "blast_1",
    status: "queued",
    recipientCount: 2,
  });
});

test("rejects content above the UniSMS long-message limit", async () => {
  await assert.rejects(() => sendUniSms({
    apiKey: "secret",
    recipient: "09778088883",
    senderId: "Unisoft",
    content: "D".repeat(671),
    fetchImpl: async () => {
      throw new Error("Provider should not be called.");
    },
  }), /1 to 670 characters/);
});

test("rejects a provider error even when UniSMS returns HTTP 200", async () => {
  await assert.rejects(() => sendUniSms({
    apiKey: "secret",
    recipient: "09778088883",
    senderId: "Unisoft",
    content: "FUELTECH TEST",
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ error: "Message rejected" }) }),
  }), /Message rejected/);
});
