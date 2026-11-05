export const DELIVERY_PRODUCTS=['Regular','Diesel','Premium'];
const products=DELIVERY_PRODUCTS;
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
export function newTankDeliveryLoad(draft,id){
  const items=Object.hasOwn(draft,'items')?(Array.isArray(draft.items)?draft.items:[]):
    products.filter(product=>text(draft.litersByProduct?.[product])!==''&&Number(draft.litersByProduct[product])!==0).map(product=>({product,liters:draft.litersByProduct[product]}));
  return {id,driverName:text(draft.driverName),time:draft.time,items:items.map(item=>{
    const row=newTankDelivery(item||{},id);return {product:row.product,liters:row.liters};
  })};
}
export function tankDeliveryLoadError(load){
  if(!load.id||String(load.id).length>60)return 'Refresh the delivery form and try again.';
  if(!text(load.driverName)||text(load.driverName).length>80)return 'Enter the driver name (up to 80 characters).';
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(load.time||''))return 'Choose the delivery time.';
  if(!Array.isArray(load.items)||!load.items.length)return 'Enter liters for at least one fuel. Leave the other fuels blank.';
  if(load.items.length>products.length||new Set(load.items.map(item=>item.product)).size!==load.items.length)return 'Enter each fuel only once in this delivery.';
  for(const item of load.items){const issue=tankDeliveryError({...load,...item});if(issue)return issue;}
  return '';
}
export function deliveryLoadEntries(load){
  return load.items.map(item=>({...newTankDelivery({...load,...item},`${load.id}:${item.product}`),deliveryId:load.id}));
}
export function groupTankDeliveries(rows){
  const groups=new Map();
  for(const [index,row] of (rows||[]).entries()){
    const id=row.deliveryId||row.id||`legacy-${index}`;
    if(!groups.has(id))groups.set(id,{id,driverName:row.driverName,time:row.time,reference:row.reference,items:[]});
    groups.get(id).items.push({product:row.product,liters:row.liters});
  }
  return [...groups.values()];
}
export function mergeDeliverySave(local,result){
  const saved=result.report;
  if(!local||!saved||['branch','date','shiftId'].some(k=>local[k]!==saved[k]))return local;
  const base=Number(local.pilotRevision||0),latest=Number(saved.pilotRevision||0);
  const lastEdit=Number(saved.pilotLastNonReadingRevision??latest);
  // An idempotent retry can return its original receipt after another device
  // saved a later delivery. Keep that newer stock list and revision.
  if(lastEdit<Number(local.pilotLastNonReadingRevision??base))return local;
  const next={...local,deliveries:saved.deliveries,tankRows:(local.tankRows||[]).map(row=>{
    const remote=saved.tankRows?.find(r=>r.tank===row.tank&&r.product===row.product);
    return remote?{...row,delivery:remote.delivery}:row;
  })};
  // A delivery owns the stock received. It cannot authorize replacing another
  // device's intervening manual edits with an older full shift draft.
  if(base>=Number(result.previousNonReadingRevision??latest)){
    next.pilotRevision=Math.max(base,latest);next.pilotLastNonReadingRevision=lastEdit;
    if(latest>=base)next.serverMeta=saved.serverMeta;
  }
  return next;
}
