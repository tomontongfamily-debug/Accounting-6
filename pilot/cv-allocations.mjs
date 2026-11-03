import { automaticCashVouchers } from './domain.mjs';
import { dateOffset } from './integrations.mjs';
import { reportKey } from '../src/accounting-engine.js';
const cents=n=>Math.round(Number(n)*100);

// Preserve source IDs and totals; allocations only assign accounting ownership.
function allocatedEvents(state,event) {
  const override=state.cvAllocationOverrides?.[event.sourceVoucherId||event.id];
  if(override&&(!override.id||!override.reason||!override.approvedBy||!Number.isFinite(Date.parse(override.approvedAt))))throw Error('Invalid approved Accounting CV allocation.');
  const allocations=override?.allocations||(override?[{date:override.toDate,shiftId:override.toShiftId,amount:event.amount}]:event.fundingAllocations);
  if(!allocations?.length)return [event];
  if(!Array.isArray(allocations)||allocations.length>(override?3:2))throw Error('Invalid CV funding allocation count.');
  const seen=new Set();let sum=0,usedLiters=0;
  const rows=allocations.map((part,index)=>{
    const date=dateOffset(part.date,0),shiftId=part.shiftId,key=reportKey(event.branch,date,shiftId),value=Number(part.amount);
    if(event.branch!=='Liloan'||date<state.startDate||!state.reports[key]||state.reports[key].baselineReport||!['shift-1','shift-2','shift-3'].includes(shiftId)||(!override&&shiftId==='shift-3')||seen.has(key)||!Number.isFinite(value)||value<=0||Math.abs(value*100-cents(value))>0.000001)throw Error('Invalid approved Accounting CV allocation.');
    if(allocations.length>2&&(!override||date>'2026-10-31'))throw Error('Only the approved October legacy reconciliation can contain three allocations.');
    seen.add(key);sum+=cents(value);
    const liters=event.fundingSource==='STATION_FUEL'?(index===allocations.length-1?Number(event.liters)-usedLiters:Number(event.liters)*value/Number(event.amount)):undefined;
    if(liters!=null)usedLiters+=liters;
    return {...event,id:event.id+':allocation-'+(index+1),date,shiftId,amount:value,...(liters==null?{}:{liters}),...(override?{accountingAllocation:override}:{})};
  });
  if(sum!==cents(event.amount))throw Error('CV funding allocations do not match the source total.');
  return rows;
}
export function cvAllocationReportKeys(state,event) {return allocatedEvents(state,event).map(e=>reportKey(e.branch,e.date,e.shiftId));}
export function cvAllocationReportKey(state,event) {return cvAllocationReportKeys(state,event)[0];}
export function accountingCashVouchers(state,report) {
  const events=(state.cvCashEvents||[]).flatMap(e=>allocatedEvents(state,e));
  const metadata=new Map(events.filter(e=>e.accountingAllocation).map(e=>[e.sourceVoucherId,e.accountingAllocation]));
  return automaticCashVouchers(events,report).map(row=>metadata.has(row.sourceVoucherId)?{...row,accountingAllocation:metadata.get(row.sourceVoucherId)}:row);
}
export function accountingFuelVouchers(state,report) {
  return (state.cvCashEvents||[]).flatMap(e=>allocatedEvents(state,e)).filter(e=>e.fundingSource==='STATION_FUEL'&&e.branch===report.branch&&e.date===report.date&&e.shiftId===report.shiftId&&['APPROVED','PAID'].includes(String(e.status).toUpperCase())).map(e=>{
    if(!['Premium','Regular','Diesel'].includes(e.fuelType)||!Number.isFinite(e.liters)||e.liters<=0)throw Error('Incomplete station Fuel CV.');
    return {id:'cv-fuel:'+e.sourceVoucherId,sourceEventId:e.id,sourceVoucherId:e.sourceVoucherId,source:'FuelTech CV',item:e.item,category:e.category,product:e.fuelType,liters:e.liters,amount:e.amount};
  });
}
