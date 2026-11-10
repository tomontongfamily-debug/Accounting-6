import {midShiftPumpKey} from './mid-shift-price-change.js';

export function mergePhoneReadings(local,saved){
  if(!local||!saved||['branch','date','shiftId'].some(k=>local[k]!==saved[k]))return local;
  const base=Number(local.pilotRevision||0),latest=Number(saved.pilotRevision||0);
  if(saved.confirmed&&latest>=base)return saved;
  const next={...local,pumpRows:(local.pumpRows||[]).map(row=>{
    const remote=saved.pumpRows?.find(p=>midShiftPumpKey(p)===midShiftPumpKey(row));
    return remote&&Number(remote.readingRevision||0)>0&&Number(remote.readingRevision)>=Number(row.readingRevision||0)?remote:row;
  })};
  // Price photos are independently saved evidence too. Never attach a photo
  // from an earlier product/time to a locally edited price-change context.
  if(local.midShiftPriceChanges)next.midShiftPriceChanges=local.midShiftPriceChanges.map(change=>{
    const remote=saved.midShiftPriceChanges?.find(item=>item.id===change.id&&item.product===change.product&&item.effectiveTime===change.effectiveTime);
    if(!remote)return change;
    const readingPhotos={...change.readingPhotos},readings={...change.readings};
    for(const [key,evidence] of Object.entries(remote.readingPhotos||{})){
      if(Number(evidence.readingRevision||0)>0&&Number(evidence.readingRevision)>=Number(readingPhotos[key]?.readingRevision||0)){
        readingPhotos[key]=evidence;readings[key]=remote.readings?.[key]??'';
      }
    }
    return {...change,readingPhotos,readings,...(latest>=base?{confirmedAt:remote.confirmedAt}: {})};
  });
  // Only independently owned phone/POS changes can advance a full draft. Other
  // desktop/manager edits retain their normal conflict checks when saving.
  if(base>=Number(saved.pilotLastNonReadingRevision??latest)&&latest>=base)next.pilotRevision=latest;
  if(latest>=base&&saved.posRedemptions?.automatic){
    next.posRedemptions=saved.posRedemptions;
    if(saved.posRedemptions.status==='verified'){
      next.deductions={...next.deductions,...Object.fromEntries(['posRedemption','cashRedemption','fuelRedemption'].filter(key=>Object.hasOwn(saved.deductions||{},key)).map(key=>[key,saved.deductions[key]]))};
      next.pointsWithdrawn=saved.pointsWithdrawn;
      if(saved.posRedemptions.pointsStatus==='verified')next.pointsIssued=saved.pointsIssued;
    }
  }
  if(latest>=base&&Number(saved.pilotCashRevision||0)>=Number(local.pilotCashRevision||0)&&saved.cashCountConfirmed){
    for(const key of ['cashCountConfirmed','actualCashCounted','cashDenominations','initialCashDenominations','pilotCashRevision'])next[key]=saved[key];
  }
  if(latest>=base){next.cashReviewState=saved.cashReviewState;next.recountRequired=saved.recountRequired;}
  return JSON.stringify(next)===JSON.stringify(local)?local:next;
}
