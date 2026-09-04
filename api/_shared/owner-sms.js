import { BRANCHES } from "./supabase.js";
import { computeReportCash } from "./health.js";

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasValue(value) {
  return value !== "" && value !== null && value !== undefined;
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

export function buildOwnerSmsSummary({ cashRows = [], reportRows = cashRows, priceRows = [], currentDate, shiftId = "shift-1" }) {
  const stationRows = BRANCHES.map((branch) => {
    const row = reportRows
      .filter((candidate) => (
        candidate.branch === branch
        && candidate.report_date === currentDate
        && candidate.shift_id === shiftId
      ))
      .sort((a, b) => String(a.updated_at || "").localeCompare(String(b.updated_at || "")))
      .at(-1);
    if (row?.data?.confirmed !== true) {
      return { branch, submitted: false, sales: 0, tankValue: 0 };
    }

    const sales = computeReportCash(row.data).grossSales;
    const prices = effectiveSellingPrices(priceRows, branch, row.report_date, row.shift_id, row.data?.prices || {});
    const tanks = row.data?.tankRows || [];
    const hasTankData = tanks.length > 0 && tanks.every((tank) => hasValue(tank.actualDip));
    const hasPrices = tanks.every((tank) => numberValue(prices[tank.product]) > 0);
    const tankValue = hasTankData && hasPrices
      ? tanks.reduce((sum, tank) => sum + numberValue(tank.actualDip) * numberValue(prices[tank.product]), 0)
      : 0;
    return { branch, submitted: true, sales, tankValue };
  });

  return {
    currentDate,
    shiftId,
    stationCount: BRANCHES.length,
    submittedReportCount: stationRows.filter((row) => row.submitted).length,
    stationRows,
    totalSales: stationRows.reduce((sum, row) => sum + numberValue(row.sales), 0),
    totalTankWorth: stationRows.reduce((sum, row) => sum + numberValue(row.tankValue), 0),
  };
}

function pesoAmount(value) {
  return numberValue(value).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function shiftOrdinal(shiftId) {
  return ({
    "shift-1": "1st shift",
    "shift-2": "2nd shift",
    "shift-3": "3rd shift",
  })[shiftId] || String(shiftId || "").replace("shift-", "Shift ");
}

function ownerSmsDate(date) {
  const [year, month, day] = String(date || "").split("-").map(numberValue);
  if (!year || !month || !day) return String(date || "");
  const monthName = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return `${monthName}. ${day}, ${year}`;
}

export function formatOwnerSms(summary, sendDate = summary.currentDate) {
  return [
    ownerSmsDate(sendDate),
    shiftOrdinal(summary.shiftId),
    `Sales - ${pesoAmount(summary.totalSales)}`,
    `Tank - ${pesoAmount(summary.totalTankWorth)}`,
  ].join("\n");
}

export function normalizePhilippineMobile(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  return "";
}

export function splitSmsContent(content, maxChunkLength = 145) {
  const chunks = [];
  let current = "";
  for (const originalLine of String(content || "").split("\n")) {
    let line = originalLine;
    while (line.length > maxChunkLength) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(line.slice(0, maxChunkLength));
      line = line.slice(maxChunkLength);
    }
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxChunkLength) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function sendUniSms({
  apiKey,
  recipient,
  recipients,
  senderId,
  content,
  startSegment = 1,
  endSegment = Number.POSITIVE_INFINITY,
  fetchImpl = fetch,
  delayImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  if (!apiKey) throw new Error("Missing UNISMS_API_KEY.");
  if (!senderId) throw new Error("Missing UNISMS_SENDER_ID.");
  if (!content || content.length > 5000) throw new Error("UniSMS content must contain 1 to 5,000 characters.");
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

  if (content.length > 160) {
    const chunks = splitSmsContent(content);
    const messages = [];
    const firstIndex = Math.max(0, Math.min(chunks.length - 1, numberValue(startSegment) - 1));
    const requestedLastIndex = Number.isFinite(Number(endSegment)) ? Number(endSegment) - 1 : chunks.length - 1;
    const lastIndex = Math.max(firstIndex, Math.min(chunks.length - 1, requestedLastIndex));
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      if (index > firstIndex) await delayImpl(4000);
      const segment = `FUELTECH ${index + 1}/${chunks.length}\n${chunks[index]}`;
      messages.push(await requestSms(
        mobileNumbers.length > 1 ? "blast" : "sms",
        mobileNumbers.length > 1 ? { recipients: mobileNumbers } : { recipient: mobileNumbers[0] },
        segment,
      ));
    }
    return {
      referenceId: messages.map((body) => body?.blast_id || body?.message?.reference_id || "").filter(Boolean).join(","),
      status: messages.every((body) => body?.message?.status === "sent") ? "sent" : "queued",
      recipientCount: mobileNumbers.length,
      segmentCount: chunks.length,
    };
  }

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
