import { dateOffset } from './integrations.mjs';
import { openingReady } from '../src/pilot-opening.js';
export { openingReady } from '../src/pilot-opening.js';
export async function launchStatus(db,config,now=new Date(),{signal}={}) {
  if(config.mode!=='live') return {ready:true};
  const openingDate=dateOffset(config.start_date,-1),startsAt=`${config.start_date}T04:00:00+08:00`;
  let head=db.from(config.storage_version===2?'fueltech_pilot_heads':'fueltech_pilot_state').select('revision').eq('mode','live').maybeSingle();
  if(signal)head=head.abortSignal(signal);
  const saved=await head;
  if(saved.error) throw Object.assign(Error('Unable to verify the live station setup.'),{code:saved.error.code});
  if(Number(saved.data?.revision)>0) return {ready:now.getTime()>=Date.parse(startsAt),timeReached:now.getTime()>=Date.parse(startsAt),openingReady:true,openingDate,openingShift:'shift-3',startsAt};
  let opening=db.from('fueltech_reports').select('data').eq('report_key',`Liloan__${openingDate}__shift-3`).maybeSingle();
  if(signal)opening=opening.abortSignal(signal);
  const {data,error}=await opening;
  if(error) throw Object.assign(Error('Unable to verify the Shift 3 opening readings.'),{code:error.code});
  const complete=openingReady(data?.data,config),timeReached=now.getTime()>=Date.parse(startsAt);
  return {ready:timeReached&&complete,timeReached,openingReady:complete,openingDate,openingShift:'shift-3',startsAt};
}
