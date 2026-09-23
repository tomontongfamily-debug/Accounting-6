import { BRANCHES } from "./supabase.js";
import { computeReportCash, computeReportFuel } from "./health.js";

const OWNER_SMS_BRANCHES = ["Mabolo", "Liloan", "Arpili", "Pondol", "Barili", "Moalboal"];

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestPriceRow(rows, predicate) {
  return rows
    .filter(predicate)
    .sort((a, b) => `${a.effective_date || ""}|${a.updated_at || ""}`.localeCompare(`${b.effective_date || ""}|${b.updated_at || ""}`))
    .at(-1);
}

export function effectiveSellingPrices(priceRows = [], branch, reportDate, shiftId, fallback = {}) {
  const branchRows = priceRows.filter((row) => row.branch === branch && row.effective_date <= reportDate);
  const daily = latestPriceRow(branchRows, (row) => row.coverage === "Daily" && row.shift_id === "daily");
  const shift = latestPriceRow(branchRows, (row) => (
    row.coverage === "Shift"
    && row.effective_date === reportDate
    && row.shift_id === shiftId
  ));
  return { ...fallback, ...(daily?.prices || {}), ...(shift?.prices || {}) };
}

export function previousOwnerSmsDate(date) {
  const [year, month, day] = String(date || "").split("-").map(numberValue);
  if (!year || !month || !day) return "";
  const previous = new Date(Date.UTC(year, month - 1, day));
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

function latestReportRow(reportRows, branch, date, shiftId) {
  return reportRows
    .filter((candidate) => (
      candidate.branch === branch
      && candidate.report_date === date
      && candidate.shift_id === shiftId
    ))
    .sort((a, b) => String(a.updated_at || "").localeCompare(String(b.updated_at || "")))
    .at(-1);
}

function stationDiscount(branch) {
  return branch === "Liloan" ? 3 : 2;
}

export function buildOwnerSmsSummary({ cashRows = [], reportRows = cashRows, currentDate, shiftId = "shift-1" }) {
  const previousDate = previousOwnerSmsDate(currentDate);
  const cashSlots = [
    { date: previousDate, shiftId: "shift-2" },
    { date: previousDate, shiftId: "shift-3" },
    { date: currentDate, shiftId: "shift-1" },
  ];
  const stationRows = OWNER_SMS_BRANCHES.map((branch) => {
    const row = latestReportRow(reportRows, branch, currentDate, shiftId);
    const discount = stationDiscount(branch);
    const periodTotals = cashSlots.reduce((totals, slot) => {
      const cashRow = latestReportRow(reportRows, branch, slot.date, slot.shiftId);
      if (cashRow?.data?.confirmed !== true) return totals;
      const cash = computeReportCash(cashRow.data);
      const fuel = computeReportFuel(cashRow.data);
      totals.reportCount += 1;
      totals.sales += cash.grossSales;
      totals.cashOnHand += cash.pendingCashOnHand;
      totals.tankValue += Math.max(0, fuel.sales - fuel.liters * discount);
      return totals;
    }, { reportCount: 0, sales: 0, tankValue: 0, cashOnHand: 0 });
    return {
      branch,
      submitted: row?.data?.confirmed === true,
      ...periodTotals,
    };
  });

  return {
    currentDate,
    previousDate,
    shiftId,
    stationCount: BRANCHES.length,
    submittedReportCount: stationRows.filter((row) => row.submitted).length,
    missingBranches: stationRows.filter((row) => !row.submitted).map((row) => row.branch),
    stationRows,
    totalSales: stationRows.reduce((sum, row) => sum + numberValue(row.sales), 0),
    totalTankWorth: stationRows.reduce((sum, row) => sum + numberValue(row.tankValue), 0),
    totalCashOnHand: stationRows.reduce((sum, row) => sum + numberValue(row.cashOnHand), 0),
  };
}

function pesoAmount(value, fractionDigits = 0) {
  return numberValue(value).toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatOwnerSms(summary) {
  const lines = [
    "Good afternoon",
    "",
    "Tank Total Value",
    ...(summary.stationRows || [])
      .filter((row) => numberValue(row.reportCount) > 0)
      .map((row) => `${row.branch}- ${pesoAmount(row.tankValue, 2)}`),
    `Grand total - ${pesoAmount(summary.totalTankWorth, 2)}`,
    "",
    "COH shift 2 yesterday, shift 3 yesterday, shift 1 today",
    ...(summary.stationRows || [])
      .filter((row) => numberValue(row.cashOnHand) > 0)
      .map((row) => `${row.branch}- ${pesoAmount(row.cashOnHand)}`),
    `Grand total = ${pesoAmount(summary.totalCashOnHand)}`,
  ];
  const missingBranches = summary.missingBranches
    || (summary.stationRows || []).filter((row) => !row.submitted).map((row) => row.branch);
  if (missingBranches.length > 0) lines.push(`${missingBranches.join(" / ")} not sent`);
  lines.push("Salamat");
  return lines.join("\n");
}

export function normalizePhilippineMobile(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  return "";
}

export async function sendUniSms({
  apiKey,
  recipient,
  recipients,
  senderId,
  content,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new Error("Missing UNISMS_API_KEY.");
  if (!senderId) throw new Error("Missing UNISMS_SENDER_ID.");
  if (!content || content.length > 670) throw new Error("UniSMS content must contain 1 to 670 characters.");
  const mobileNumbers = [...new Set((recipients?.length ? recipients : [recipient])
    .map(normalizePhilippineMobile)
    .filter(Boolean))];
  if (!mobileNumbers.length) throw new Error("OWNER_MOBILE_NUMBERS must contain a valid Philippine mobile number.");
  const requestSms = async (path, payload, messageContent = content) => {
    const response = await fetchImpl(`https://unismsapi.com/api/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...payload,
        content: messageContent,
        sender_id: senderId,
        metadata: { source: "fueltech_daily_owner_summary" },
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.error || body?.success === false) {
      const message = body?.error || body?.message || `UniSMS request failed with status ${response.status}.`;
      throw new Error(typeof message === "string" ? message : `UniSMS request failed with status ${response.status}.`);
    }
    return body;
  };

  const isBlast = mobileNumbers.length > 1;
  const body = await requestSms(isBlast ? "blast" : "sms", (
    isBlast ? { recipients: mobileNumbers } : { recipient: mobileNumbers[0] }
  ));
  return {
    referenceId: body?.blast_id || body?.message?.reference_id || "",
    status: body?.message?.status || "queued",
    recipientCount: mobileNumbers.length,
  };
}
