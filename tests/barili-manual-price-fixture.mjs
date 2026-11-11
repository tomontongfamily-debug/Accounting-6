import {fixture} from './pilot-fixture.mjs';
import {prepareStationRollout} from '../pilot/station-rollout.mjs';
import {withStationRollout} from '../src/station-rollout.js';
import {createReport,reportKey} from '../src/accounting-engine.js';
import {midShiftPumpKey} from '../src/mid-shift-price-change.js';
import {BARILI_MANUAL_PRICE_GRANT as initialGrant} from '../src/temporary-price-reading.js';

export function bariliManualFixture(product='Premium',grant=initialGrant){
 const {state}=fixture();Object.assign(state,{mode:'live',startDate:'2026-10-03'});
 const config=withStationRollout({ok:true,mode:'live',start_date:state.startDate,launch:{ready:true}});prepareStationRollout(state,config);
 const previousDate=new Date(Date.parse(grant.date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const prices={Premium:93.9,Regular:92.9,Diesel:94.1};state.priceBook.Barili={[previousDate]:prices};
 for(const previous of [state.reports['Barili__2026-11-04__shift-3'],createReport('Barili',previousDate,prices,'shift-3'),...(grant.shiftId==='shift-2'?[createReport('Barili',grant.date,prices,'shift-1')]:[])]){
  Object.assign(previous,{confirmed:true,baselineConfirmed:true,openingSetupComplete:true});
  for(const row of previous.pumpRows)Object.assign(row,{opening:10000,closing:10000,closingEntered:true});
  for(const row of previous.tankRows)Object.assign(row,{opening:1000,actualDip:1000});
  state.reports[reportKey(previous.branch,previous.date,previous.shiftId)]=previous;
 }
 const report=createReport(grant.branch,grant.date,prices,grant.shiftId),key=reportKey(report.branch,report.date,report.shiftId);
 Object.assign(report,{pilot:true,cashierName:'Test cashier',baselineConfirmed:true,baselineMissing:false,pilotRevision:3,pilotLastNonReadingRevision:3});
 for(const row of report.pumpRows){Object.assign(row,{opening:10000,closing:10020,setupRequired:false,closingEntrySource:'cashier',closingEntered:true,readingConfirmed:true,readingRevision:2,photo_path:'/api/pilot/photo?id=closing-'+row.id});state.photos[row.photo_path]={reportKey:key,rowId:row.id,branch:report.branch};}
 for(const row of report.tankRows)Object.assign(row,{opening:1000,actualDip:1000});
 const change={id:product==='Premium'?(grant.changeId||'tpzj411'):'test-'+product,product,newPrice:{Premium:91.9,Regular:90.9,Diesel:92.1}[product],effectiveTime:grant.effectiveTime||(grant.shiftId==='shift-2'?'15:07':'08:18'),photoRequired:true,readings:{},readingPhotos:{}};
 const rows=report.pumpRows.filter(row=>row.product===product),first=rows[0],path='/api/pilot/photo?id=original-price-photo';
 change.readings[midShiftPumpKey(first)]=10010;change.readingPhotos[midShiftPumpKey(first)]={photo_path:path,readingConfirmed:true,readingRevision:2,ocr_detected_reading:10010,ocr_result:{status:'detected',version:'fixture'}};
 state.photos[path]={reportKey:key,rowId:first.id,branch:report.branch,changeId:change.id,product:change.product,effectiveTime:change.effectiveTime};
 report.midShiftBasePrices={...prices};report.midShiftPriceChanges=[change];state.reports[key]=report;
 return {state,config,report,key,change,rows,cashier:{role:'Cashier',branch:'Barili'},manager:{role:'Manager',branch:'Barili'}};
}
