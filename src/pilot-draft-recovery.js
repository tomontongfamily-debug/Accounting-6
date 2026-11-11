import {midShiftChangeHasDetails} from './mid-shift-price-change.js';

// An older empty manager draft must not hide price changes already saved on
// another device. Managers save only price metadata through the full draft
// action, so accepting that metadata's revision cannot overwrite cash inputs.
export function recoverManagerPriceDraft(draft,saved){
  if(!draft||!saved?.pilot||['branch','date','shiftId'].some(key=>draft[key]!==saved[key]))return draft;
  if(Number(saved.pilotRevision||0)<=Number(draft.pilotRevision||0)
    ||(draft.midShiftPriceChanges||[]).some(midShiftChangeHasDetails)
    ||!(saved.midShiftPriceChanges||[]).some(midShiftChangeHasDetails))return draft;
  return {...draft,midShiftPriceChanges:saved.midShiftPriceChanges,midShiftBasePrices:saved.midShiftBasePrices,
    pilotRevision:saved.pilotRevision,pilotLastNonReadingRevision:saved.pilotLastNonReadingRevision};
}

// A local recovery copy can still have the revision from before its successful
// save. The server's acknowledgement identifies that copy without replaying it.
export function pilotDraftAlreadySaved(draft, saved) {
  if (!saved?.pilot || !draft || ['branch', 'date', 'shiftId'].some(key => draft[key] !== saved[key])) return false;
  const local = draft.clientSave, online = saved.clientSave;
  return Boolean(local?.clientId && local.clientId === online?.clientId
    && Number(local.version) > 0 && Number(online.version) >= Number(local.version));
}
