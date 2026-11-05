const products=['Premium','Regular','Diesel'];
const text=value=>String(value||'').trim().replace(/\s+/g,' ');
export function tankDeliveryError(delivery){
  if(!products.includes(delivery.product))return 'Choose the fuel delivered.';
  if(typeof delivery.liters==='boolean'||!Number.isFinite(Number(delivery.liters))||Number(delivery.liters)<=0||Number(delivery.liters)>1e12)return 'Enter the liters delivered.';
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(delivery.time||''))return 'Choose the delivery time.';
  if(Object.hasOwn(delivery,'driverName')){
    if(!text(delivery.driverName)||text(delivery.driverName).length>80)return 'Enter the driver name (up to 80 characters).';
    if(!delivery.id||String(delivery.id).length>80)return 'Refresh the delivery form and try again.';
  }else if(!text(delivery.reference))return 'Complete the saved delivery details.';
  return '';
}
export function sameTankDelivery(a,b,{sameDate=true}={}){
  if(a.id&&a.id===b.id)return true;
  if(a.product!==b.product)return false;
  if(text(a.reference)&&text(a.reference).toLowerCase()===text(b.reference).toLowerCase())return true;
  return sameDate&&!!text(a.driverName)&&text(a.driverName).toLowerCase()===text(b.driverName).toLowerCase()
    &&a.time===b.time&&Number(a.liters)===Number(b.liters);
}
export function newTankDelivery(draft,id){
  return {id,driverName:text(draft.driverName),product:draft.product,liters:['string','number'].includes(typeof draft.liters)?Number(draft.liters):NaN,time:draft.time,reference:''};
}
export function mergeDeliverySave(local,result){
  const saved=result.report;
  if(!local||!saved||['branch','date','shiftId'].some(k=>local[k]!==saved[k]))return local;
  const next={...local,deliveries:saved.deliveries,tankRows:(local.tankRows||[]).map(row=>{
    const remote=saved.tankRows?.find(r=>r.tank===row.tank&&r.product===row.product);
    return remote?{...row,delivery:remote.delivery}:row;
  })};
  // A delivery owns the stock received. It cannot authorize replacing another
  // device's intervening manual edits with an older full shift draft.
  if(Number(local.pilotRevision||0)>=Number(result.previousNonReadingRevision??saved.pilotRevision??0)){
    next.pilotRevision=saved.pilotRevision;next.pilotLastNonReadingRevision=saved.pilotLastNonReadingRevision;next.serverMeta=saved.serverMeta;
  }
  return next;
}
