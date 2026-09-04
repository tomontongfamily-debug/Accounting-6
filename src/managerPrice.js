const MANAGER_PRICE_DRAFT_PATTERN = /^\d*(?:\.\d{0,2})?$/;

export function normalizeManagerPriceDraft(value) {
  const normalized = String(value ?? "")
    .replace(/[\u002c\u00b7\u060c\u066b\uff0c\uff0e]/g, ".")
    .replace(/\s/g, "");
  return MANAGER_PRICE_DRAFT_PATTERN.test(normalized) ? normalized : null;
}

export function insertManagerPriceDecimal(value, selectionStart, selectionEnd = selectionStart) {
  const draft = normalizeManagerPriceDraft(value);
  if (draft === null) return null;
  const existingDecimal = draft.indexOf(".");
  if (existingDecimal >= 0) {
    return { value: draft, caret: existingDecimal + 1 };
  }
  const start = Number.isInteger(selectionStart) ? selectionStart : draft.length;
  const end = Number.isInteger(selectionEnd) ? selectionEnd : start;
  const next = normalizeManagerPriceDraft(`${draft.slice(0, start)}.${draft.slice(end)}`);
  return next === null ? null : { value: next, caret: start + 1 };
}

export function committedManagerPrice(value) {
  const normalized = normalizeManagerPriceDraft(value);
  if (normalized === null || normalized === "") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed.toFixed(2) : null;
}
