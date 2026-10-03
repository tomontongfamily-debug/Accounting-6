import {midShiftPumpKey} from './mid-shift-price-change.js';

export function mergePhoneReadings(local,saved){
  if(!local||!saved||['branch','date','shiftId'].some(k=>local[k]!==saved[k]))return local;
  const base=Number(local.pilotRevision||0),latest=Number(saved.pilotRevision||0);
  if(saved.confirmed&&latest>=base)return saved;
  const next={...local,pumpRows:(local.pumpRows||[]).map(row=>{
    const remote=saved.pumpRows?.find(p=>midShiftPumpKey(p)===midShiftPumpKey(row));
    return remote&&Number(remote.readingRevision||0)>0&&Number(remote.readingRevision)>=Number(row.readingRevision||0)?remote:row;
  })};
  // Only phone-owned changes can advance a full draft's revision. Unrelated
  // desktop/manager edits retain their normal conflict checks when saving.
  if(base>=Number(saved.pilotLastNonReadingRevision??latest)&&latest>=base)next.pilotRevision=latest;
  if(latest>=base&&Number(saved.pilotCashRevision||0)>=Number(local.pilotCashRevision||0)&&saved.cashCountConfirmed){
    for(const key of ['cashCountConfirmed','actualCashCounted','cashDenominations','initialCashDenominations','pilotCashRevision'])next[key]=saved[key];
  }
  if(latest>=base){next.cashReviewState=saved.cashReviewState;next.recountRequired=saved.recountRequired;}
  return JSON.stringify(next)===JSON.stringify(local)?local:next;
}
