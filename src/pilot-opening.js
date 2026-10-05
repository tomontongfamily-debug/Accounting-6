import { createReport } from './accounting-engine.js';

// The pilot begins with the closing shift immediately before its configured
// first reporting day. This is independent of the legacy July opening setup.
export function pilotOpeningSlot(config) {
  const date=config?.start_date;
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Invalid pilot start date');
  const day=new Date(`${date}T00:00:00Z`);
  if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==date)throw Error('Invalid pilot start date');
  day.setUTCDate(day.getUTCDate()-1);
  return {date:day.toISOString().slice(0,10),shiftId:'shift-3'};
}

const entered=value=>value!==''&&value!=null&&Number.isFinite(Number(value))&&Number(value)>=0;
const pumpKey=row=>`${row.pump}|${row.nozzle}|${row.product}`;
const tankKey=row=>`${row.tank}|${row.product}`;

export function openingReady(report,config) {
  const opening=pilotOpeningSlot(config);
  if(!report?.confirmed||report.branch!=='Liloan'||report.date!==opening.date||report.shiftId!==opening.shiftId)return false;
  const template=createReport('Liloan',config.start_date,{},'shift-1');
  return template.pumpRows.every(row=>{
    const matched=(report.pumpRows||[]).filter(item=>pumpKey(item)===pumpKey(row));
    return matched.length===1&&entered(matched[0].closing)&&matched[0].closingEntered&&Number(matched[0].closing)>=Number(matched[0].opening);
  })&&template.tankRows.every(row=>{
    const matched=(report.tankRows||[]).filter(item=>tankKey(item)===tankKey(row));
    return matched.length===1&&entered(matched[0].actualDip);
  });
}
