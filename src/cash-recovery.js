import {denominationTotal} from './error-reduction.ts';

export function recoverCashDraft(latest,denominations){
  // Reload all saved shift fields. Only an unconfirmed physical count stays local.
  if(latest.confirmed||latest.cashCountConfirmed||denominations===null)return latest;
  return {...latest,cashDenominations:{...denominations},actualCashCounted:denominationTotal(denominations)};
}
