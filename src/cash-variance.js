export function physicalCashVariance(actualCashCounted, expectedCash, hasPhysicalCount = true) {
  if (!hasPhysicalCount) return 0;
  return Math.round(((Number(actualCashCounted) || 0) - (Number(expectedCash) || 0)) * 100) / 100;
}

export function depositAllocationDifference(bankDeposit, pendingCashOnHand, expectedCash) {
  return Math.round(((Number(bankDeposit) || 0) + (Number(pendingCashOnHand) || 0) - (Number(expectedCash) || 0)) * 100) / 100;
}
