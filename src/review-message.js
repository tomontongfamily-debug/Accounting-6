const money = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function reportDateLabel(date) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function reviewGreeting(hour = new Date().getHours()) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function buildReviewMessage({
  cashierName,
  branch,
  date,
  shiftLabel,
  expectedCash,
  actualCashCounted,
  actualCashCountEntered,
  cashVariance,
  flags = [],
  hour,
}) {
  const name = String(cashierName || "").trim();
  const greeting = `${reviewGreeting(hour)}.`;
  const shiftName = name ? `${name}'s ${shiftLabel}` : shiftLabel;
  const reportName = `${shiftName} report at ${branch} on ${reportDateLabel(date)}`;
  const hasCashVariance = flags.includes("High cash variance") && actualCashCountEntered;
  const hasHighLiters = flags.includes("High liters sold");
  const varianceDirection = cashVariance > 0 ? "positive" : cashVariance < 0 ? "negative" : "zero";
  const varianceAmount = money.format(Math.abs(cashVariance));

  const concern = hasCashVariance
    ? `It has a ${varianceDirection} cash variance of ${varianceAmount}. Expected cash is ${money.format(expectedCash)}, while physical cash counted is ${money.format(actualCashCounted)}.`
    : hasHighLiters
      ? "It has unusually high liters sold."
      : "It is marked Check Required.";

  const request = hasHighLiters
    ? "Please double-check the pump register opening and closing readings, especially the unusually high pump or product entry."
    : "Please double-check the pump readings, physical cash count, deductions, FuelTech Pay, PO accounts, and cash vouchers.";

  return `${greeting} Please review ${reportName}. ${concern} ${request} Let me know what caused the difference if the entries are correct.`;
}
