import test from "node:test";
import assert from "node:assert/strict";
import { buildOwnerSmsSummary, effectiveSellingPrices, formatOwnerSms, normalizePhilippineMobile, sendUniSms } from "../api/_shared/owner-sms.js";

const branches = ["Mabolo", "Arpili", "Liloan", "Pondol", "Barili", "Moalboal"];

function reportRow(branch, { date = "2026-09-01", shiftId = "shift-1", sales = 1000, dip = 100, confirmed = true } = {}) {
  return {
    branch,
    report_date: date,
    shift_id: shiftId,
    updated_at: `${date}T12:00:00Z`,
    data: {
      confirmed,
      oilSales: sales,
      pumpRows: [],
      prices: { Premium: 70, Regular: 69, Diesel: 68 },
      tankRows: [
        { product: "Premium", actualDip: dip },
        { product: "Regular", actualDip: dip },
        { product: "Diesel", actualDip: dip },
      ],
    },
  };
}

test("builds one all-station sales and tank total for first shift", () => {
  const rows = branches.map((branch, index) => reportRow(branch, {
    sales: (index + 1) * 10000,
    dip: (index + 1) * 100,
  }));
  const summary = buildOwnerSmsSummary({
    reportRows: rows,
    priceRows: [],
    currentDate: "2026-09-01",
  });
  assert.equal(summary.submittedReportCount, 6);
  assert.equal(summary.totalSales, 210000);
  assert.equal(summary.stationRows[0].tankValue, 20700);
  assert.equal(summary.totalTankWorth, 434700);
  assert.equal(formatOwnerSms(summary), [
    "Sep. 1, 2026",
    "1st shift",
    "Sales - 210,000",
    "Tank - 434,700",
  ].join("\n"));
});

test("totals only confirmed reports for the requested date and shift", () => {
  const submitted = branches.slice(0, 4).map((branch) => reportRow(branch, { sales: 1000, dip: 10 }));
  const rows = [
    ...submitted,
    reportRow("Barili", { sales: 9000, confirmed: false }),
    reportRow("Moalboal", { date: "2026-08-31", sales: 9000 }),
    reportRow("Mabolo", { shiftId: "shift-2", sales: 9000 }),
  ];
  const summary = buildOwnerSmsSummary({
    reportRows: rows,
    priceRows: [],
    currentDate: "2026-09-01",
  });
  assert.equal(summary.submittedReportCount, 4);
  assert.equal(summary.totalSales, 4000);
  assert.equal(summary.totalTankWorth, 8280);
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

test("sends a detailed long report as numbered SMS segments", async () => {
  const requests = [];
  const content = "D".repeat(800);
  const result = await sendUniSms({
    apiKey: "secret",
    recipients: ["09778088883", "09999988880"],
    senderId: "Unisoft",
    content,
    delayImpl: async () => {},
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      const requestNumber = requests.length;
      return {
        ok: true,
        status: 200,
        json: async () => ({ blast_id: `blast_${requestNumber}` }),
      };
    },
  });
  assert.equal(requests.length, 6);
  assert.ok(requests.every((request) => request.url === "https://unismsapi.com/api/blast"));
  assert.ok(requests.every((request) => request.body.content.length <= 160));
  assert.deepEqual(requests[0].body.recipients, ["+639778088883", "+639999988880"]);
  assert.match(requests[0].body.content, /^FUELTECH 1\/6\n/);
  assert.match(requests[5].body.content, /^FUELTECH 6\/6\n/);
  assert.deepEqual(result, {
    referenceId: "blast_1,blast_2,blast_3,blast_4,blast_5,blast_6",
    status: "queued",
    recipientCount: 2,
    segmentCount: 6,
  });
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
