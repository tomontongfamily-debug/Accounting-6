export function normalizeBranchPinDraft(value, maxLength = 6) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\D/g, "")
    .slice(0, maxLength);
}

export function normalizePinForComparison(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s/g, "");
}
