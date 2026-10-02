import { createReport } from '../src/accounting-engine.js';
import { dateOffset } from './integrations.mjs';
const entered=value=>value!==''&&value!=null&&Number.isFinite(Number(value))&&Number(value)>=0;
const pumpKey=r=>`${r.pump}|${r.nozzle}|${r.product}`;
const tankKey=r=>`${r.tank}|${r.product}`;
export function openingReady(report,config) {
  if(!report?.confirmed||report.branch!=='Liloan'||report.date!==dateOffset(config.start_date,-1)||report.shiftId!=='shift-3') return false;
  const template=createReport('Liloan',config.start_date,{},'shift-1');
  return template.pumpRows.every(row=>{const matched=(report.pumpRows||[]).filter(r=>pumpKey(r)===pumpKey(row));return matched.length===1&&entered(matched[0].closing)&&matched[0].closingEntered&&Number(matched[0].closing)>=Number(matched[0].opening);})
    &&template.tankRows.every(row=>{const matched=(report.tankRows||[]).filter(r=>tankKey(r)===tankKey(row));return matched.length===1&&entered(matched[0].actualDip);});
}
export async function launchStatus(db,config,now=new Date()) {
  if(config.mode!=='live') return {ready:true};
  const openingDate=dateOffset(config.start_date,-1),startsAt=`${config.start_date}T04:00:00+08:00`;
  const saved=await db.from('fueltech_pilot_state').select('revision').eq('mode','live').maybeSingle();
  if(saved.error) throw Error('Unable to verify the live station setup.');
  if(Number(saved.data?.revision)>0) return {ready:now.getTime()>=Date.parse(startsAt),timeReached:now.getTime()>=Date.parse(startsAt),openingReady:true,openingDate,openingShift:'shift-3',startsAt};
  const {data,error}=await db.from('fueltech_reports').select('data').eq('report_key',`Liloan__${openingDate}__shift-3`).maybeSingle();
  if(error) throw Error('Unable to verify the Shift 3 opening readings.');
  const complete=openingReady(data?.data,config),timeReached=now.getTime()>=Date.parse(startsAt);
  return {ready:timeReached&&complete,timeReached,openingReady:complete,openingDate,openingShift:'shift-3',startsAt};
}
