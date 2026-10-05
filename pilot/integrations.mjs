import { createHash } from 'node:crypto';

export const LILOAN_STATION_ID = '33333333-3333-4333-8333-333333333333';
export function dateOffset(date, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Invalid business date');
  const d = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10)!==date) throw Error('Invalid business date');
  d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10);
}
export function accountingTiming(timestamp) {
  if(typeof timestamp!=='string'||!/(Z|[+-]\d{2}:\d{2})$/i.test(timestamp)) throw Error('Source event needs an explicit timezone');
  const instant = new Date(timestamp);
  if (!timestamp || !Number.isFinite(instant.getTime())) throw Error('Source cash event has no valid time');
  const local = new Date(instant.getTime()+8*3600000);
  const hour=local.getUTCHours(), date=local.toISOString().slice(0,10);
  return {date:hour<4?dateOffset(date,-1):date,shiftId:hour<4||hour>=22?'shift-3':hour<13?'shift-1':'shift-2'};
}
export function sourceTiming(businessDate, shift) {
  const shiftId=String(shift).toLowerCase().replace(' ','-');
  if (!['shift-1','shift-2','shift-3'].includes(shiftId)) throw Error('Unknown source shift');
  return {date:dateOffset(businessDate,shiftId==='shift-3'?-1:0),shiftId};
}
function money(value) {
  if(value===null||value===''||!Number.isFinite(Number(value))||Number(value)<0) throw Error('Invalid source amount');
  return Math.round(Number(value)*100)/100;
}
function unique(rows) {
  const byId=new Map();
  for(const row of rows){
    if(!row.id) throw Error('Source record has no ID');
    if(byId.has(row.id)&&JSON.stringify(byId.get(row.id))!==JSON.stringify(row)) throw Error('Conflicting duplicate source record');
    byId.set(row.id,row);
  }
  return [...byId.values()];
}
export function verifiedPaymentTime(row) {
  // The Pay app can fall back to notification arrival time when gateway evidence
  // lacks paid_at. Never silently use that fallback for an Accounting shift.
  const root=row.raw_webhook?.data;
  const resource=root?.data||root?.attributes?.data||root;
  const attributes=resource?.attributes;
  const payments=attributes?.payments||attributes?.payment_intent?.attributes?.payments||[];
  const paid=payments.filter(p=>['paid','succeeded'].includes(String(p.attributes?.status).toLowerCase()));
  const values=[attributes?.paid_at,...paid.map(p=>p.attributes?.paid_at)].filter(v=>v!=null);
  if(!values.length||values.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<=0)||new Set(values).size!==1) throw Error('A paid transaction has missing or conflicting gateway payment time. Review the Pay record before submission.');
  const timestamp=new Date(values[0]*1000);
  if(!Number.isFinite(timestamp.getTime())||timestamp.getTime()!==Date.parse(row.paid_at)) throw Error('A paid transaction time differs from its gateway evidence. Review the Pay record before submission.');
  return timestamp.toISOString();
}
export function normalizeSources({pay=[],po=[],cv=[]}, startDate) {
  // Accounting owns the shift clock. Checkout labels are not authoritative:
  // a checkout started at 12:59 but paid at 13:01 belongs to Shift 2.
  const payments=pay.filter(r=>r.station_id===LILOAN_STATION_ID&&r.status==='PAID').map(r=>({id:r.id,branch:'Liloan',...accountingTiming(r.paid_at),eventTime:r.paid_at,amount:money(r.base_amount),status:'PAID'}));
  const purchaseOrders=po.filter(r=>r.station_id===LILOAN_STATION_ID&&r.status==='POSTED').map(r=>({id:r.id,branch:'Liloan',...accountingTiming(r.transaction_at),eventTime:r.transaction_at,amount:money(r.amount),status:'POSTED',account:r.customer_name,transactionNumber:r.transaction_number,vehicle:r.vehicle_name,plateNumber:r.plate_number,fuelType:r.fuel_type,liters:money(r.liters)}));
  const acceptedCv=cv.filter(r=>r.station==='liloan'&&r.payment_method==='cash'&&['approved','liquidated','cleared','released'].includes(r.status));
  const vouchers=acceptedCv.filter(r=>accountingTiming(r.created_at).date>=startDate).map(r=>{
    const category=Array.isArray(r.category)?r.category[0]?.name:r.category?.name;
    if(!['OPEX','Personal','Construction'].includes(category)) throw Error('Unknown CV category');
    // Approval controls eligibility; creation controls the Accounting shift.
    return {id:r.id,sourceVoucherId:r.id,reference:r.ref,branch:'Liloan',...accountingTiming(r.created_at),eventTime:r.created_at,assignmentBasis:'created_at',amount:money(r.amount),status:'APPROVED',fundingSource:'STATION_CASH',category,item:String(r.purpose||r.material||r.ref||'Cash voucher')};
  });
  const cvExclusions=unique(cv.filter(r=>r.station==='liloan'&&r.payment_method==='cash'&&['cancelled','declined'].includes(r.status)).map(r=>({id:r.id,status:r.status})));
  const cvOutOfScope=unique(acceptedCv.filter(r=>accountingTiming(r.created_at).date<startDate).map(r=>({id:r.id,status:'created-before-pilot'})));
  const result={pay:unique(payments).filter(r=>r.date>=startDate),po:unique(purchaseOrders).filter(r=>r.date>=startDate),cvCashEvents:unique(vouchers),cvExclusions,cvOutOfScope};
  result.sourceFingerprint=createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,v.sort((a,b)=>a.id.localeCompare(b.id))])))).digest('hex');
  return result;
}
async function paged(makeQuery) {
  const result=[];
  for(let offset=0;;offset+=1000){
    const {data,error}=await makeQuery().range(offset,offset+999);
    if(error) throw Error(`Source import unavailable: ${error.message}`);
    result.push(...data); if(data.length<1000)return result;
  }
}
export async function loadSources(accounting, cvClient, startDate, endDate) {
  const from=`${startDate}T04:00:00+08:00`,until=`${dateOffset(endDate,1)}T04:00:00+08:00`;
  // Payments use actual paid time, PO uses transaction time, and accepted CVs
  // use creation time. Client-entered shift labels never determine allocation.
  // Missing timestamps are surfaced instead of silently excluded as zero cash.
  const missing=await Promise.all([
    accounting.from('transactions').select('id',{count:'exact',head:true}).eq('station_id',LILOAN_STATION_ID).eq('status','PAID').is('paid_at',null).gte('business_date',startDate).lte('business_date',dateOffset(endDate,1)),
    accounting.from('po_transactions').select('id',{count:'exact',head:true}).eq('station_id',LILOAN_STATION_ID).eq('status','POSTED').is('transaction_at',null).gte('business_date',startDate).lte('business_date',dateOffset(endDate,1)),
    cvClient.from('cv_station_vouchers').select('id',{count:'exact',head:true}).eq('station','liloan').eq('payment_method','cash').in('status',['approved','liquidated','cleared','released']).is('created_at',null),
  ]);
  if(missing.some(r=>r.error)) throw Error('Source import unavailable: timestamp verification failed');
  if(missing.some(r=>r.count>0)) throw Error('A released/paid source entry is missing its event time. Review it before submission.');
  const [pay,po,cv,excludedCv,earlierCv]=await Promise.all([
    paged(()=>accounting.from('transactions').select('id,station_id,paid_at,status,base_amount,raw_webhook').eq('station_id',LILOAN_STATION_ID).gte('paid_at',from).lt('paid_at',until).eq('status','PAID').order('id')),
    paged(()=>accounting.from('po_transactions').select('id,station_id,transaction_at,status,amount,customer_name,transaction_number,vehicle_name,plate_number,fuel_type,liters').eq('station_id',LILOAN_STATION_ID).gte('transaction_at',from).lt('transaction_at',until).eq('status','POSTED').order('id')),
    paged(()=>cvClient.from('cv_station_vouchers').select('id,ref,station,status,payment_method,created_at,amount,purpose,material,category:cv_station_categories(name)').eq('station','liloan').eq('payment_method','cash').gte('created_at',from).lt('created_at',until).order('id')),
    // Cancellation may overwrite decided_at. Read explicit exclusions separately
    // so cancelling later still removes the original shift's deduction.
    paged(()=>cvClient.from('cv_station_vouchers').select('id,station,status,payment_method').eq('station','liloan').eq('payment_method','cash').in('status',['cancelled','declined']).order('id')),
    // Remove old imports assigned by approval time when their creation was
    // before the pilot. Earlier submitted reports remain read-only.
    paged(()=>cvClient.from('cv_station_vouchers').select('id,station,status,payment_method,created_at').eq('station','liloan').eq('payment_method','cash').in('status',['approved','liquidated','cleared','released']).lt('created_at',from).order('id')),
  ]);
  const byCvId=new Map(cv.map(row=>[row.id,row]));
  for(const row of excludedCv) byCvId.set(row.id,row);
  for(const row of earlierCv) if(!byCvId.has(row.id))byCvId.set(row.id,row);
  return normalizeSources({pay:pay.map(row=>({...row,paid_at:verifiedPaymentTime(row)})),po,cv:[...byCvId.values()]},startDate);
}
