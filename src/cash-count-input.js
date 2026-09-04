export function normalizeCashCountInput(value) {
  if (value === "" || value === null || value === undefined) return "";
  const raw = String(value).replace(/\s/g, "");
  if (!/^\d[\d,]*(?:\.\d*)?$/.test(raw)) return null;

  const normalized = raw.replace(/,/g, "");
  if (!/^\d+(?:\.\d*)?$/.test(normalized)) return null;
  return normalized;
}

export function formatCashCountInput(value) {
  const normalized = normalizeCashCountInput(value);
  if (normalized === null || normalized === "") return normalized ?? "";

  const hasDecimal = normalized.includes(".");
  const [integerPart, decimalPart = ""] = normalized.split(".");
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return hasDecimal ? `${groupedInteger}.${decimalPart}` : groupedInteger;
}
