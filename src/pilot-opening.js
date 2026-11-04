import { createReport } from './accounting-engine.js';
import { configuredStations, stationOpeningSlot, stationStartDate } from './station-rollout.js';

// The pilot begins with the closing shift immediately before its configured
// first reporting day. This is independent of the legacy July opening setup.
export function pilotOpeningSlot(config, branch = 'Liloan') { return stationOpeningSlot(config, branch); }

const entered=value=>value!==''&&value!=null&&Number.isFinite(Number(value))&&Number(value)>=0;
const pumpKey=row=>`${row.pump}|${row.nozzle}|${row.product}`;
const tankKey=row=>`${row.tank}|${row.product}`;

export function openingReady(report,config) {
  const opening=pilotOpeningSlot(config, report?.branch);
  if(!report?.confirmed||!configuredStations(config).includes(report.branch)||report.date!==opening.date||report.shiftId!==opening.shiftId)return false;
  const template=createReport(report.branch,stationStartDate(config,report.branch),{},'shift-1');
  return template.pumpRows.every(row=>{
    const matched=(report.pumpRows||[]).filter(item=>pumpKey(item)===pumpKey(row));
    return matched.length===1&&entered(matched[0].closing)&&matched[0].closingEntered&&Number(matched[0].closing)>=Number(matched[0].opening);
  })&&template.tankRows.every(row=>{
    const matched=(report.tankRows||[]).filter(item=>tankKey(item)===tankKey(row));
    return matched.length===1&&entered(matched[0].actualDip);
  });
}
