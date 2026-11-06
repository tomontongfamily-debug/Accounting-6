import { pendingVouchersForReport } from '../src/pending-vouchers.js';
import { requiresZeroSalesConfirmation, zeroSalesReviewKey } from '../src/zero-sales.js';
import { configuredStations, stationStartDate, isStationOpening } from '../src/station-rollout.js';
import { refreshFuelCVReview } from '../src/cv-fuel-issues.js';
import { randomUUID } from 'node:crypto';
import { createReport, compute, carryForwardOpenings, getEffectivePricing, getEffectiveDailyPricing, reportKey } from '../src/accounting-engine.js';
import { CASH_DENOMINATIONS, amount, automaticTransactions, cashNeedsRecount, datePlus, denominationTotal, depositAmounts, depositCoverage, money, permittedDay, readingComplete, readingWarning, reportIssues, reservedReportCash, availableCarryover } from './domain.mjs';
import { accountingCashVouchers, accountingFuelVouchers } from './cv-allocations.mjs';
import { refreshManagerReconciliation, managerDepositCoverageIssues } from '../src/manager-reconciliation.js';
import { midShiftPumpKey, midShiftReadingValue, midShiftReadingIssues, midShiftChangeHasDetails } from '../src/mid-shift-price-change.js';
import { mergeOcrEvidence, TOTALIZER_VERSION } from '../src/ocr-evidence.js';

import { accountingTiming, dateOffset } from './integrations.mjs';
import { storePage } from '../api/_shared/store-page.js';
import { validateFuelLeakLosses } from '../src/fuel-leak-loss.js';
import {tankDeliveryError,sameTankDelivery,newTankDelivery,newTankDeliveryLoad,tankDeliveryLoadError,deliveryLoadEntries} from '../src/tank-deliveries.js';
import { refreshPosReport } from './pos-redemptions.mjs';
import { SELLING_PRODUCTS, carryMidShiftPrices, confirmedDailyPricePatch, syncUnsubmittedPrices } from './prices.mjs';
const stamp=()=>new Date().toISOString();
const keyOf=r=>reportKey(r.branch,r.date,r.shiftId);
const reject=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const rejectStaleCorrection=message=>{throw Object.assign(new Error(message),{status:409,staleDraft:true});};
export async function runAction(state,session,route,input={},options={}) {
 const database=structuredClone(state);
 let changed=false;
 const save=()=>{changed=true;};
 const send=result=>{
   if(changed) for(const report of Object.values(database.reports)) if(report.date>=database.startDate&&report.confirmed) report.pilotCashAwaitingDeposit=authoritative(report).pilotCashAwaitingDeposit;
   return {state:database,changed,result};
 };
 const mutationId=options.mutationId||randomUUID();
 const uploadPhoto=options.uploadPhoto||(()=>{throw Error('Photo storage unavailable');});
 const getCurrentShift=()=>accountingTiming(new Date().toISOString());
 function audit(action,actor,details={}) {database.audit.push({id:randomUUID(),at:stamp(),action,role:actor.role,branch:actor.branch,...details});}
 if(['Cashier','Manager'].includes(session.role)&&!configuredStations(database).includes(session.branch))reject('This report belongs to another station.',403);
 branchAccess(session,session.branch||'Liloan');
 if(!['Cashier','Manager','Admin','Approver'].includes(session.role)) reject('Invalid role.',403);
function requireRole(session,...roles) { if(!roles.includes(session.role)) reject('This action is not available for your role.',403); }
function branchAccess(session,branch) {
  if(!configuredStations(database).includes(branch)) reject('Unknown station.');
  if(['Cashier','Manager'].includes(session.role)&&branch!==session.branch) reject('This report belongs to another station.',403);
}
function authoritative(r) {
  if(r.branch==='Moalboal')r={...r,deductions:{...r.deductions,bankCard:r.deductions?.bankCard??0}};
  r=refreshFuelCVReview(refreshManagerReconciliation(r,database),compute(r));
  if(r.date<stationStartDate(database,r.branch)) return refreshPosReport(r,database.posRedemptionSync);
  const pay=automaticTransactions(database.pay,r), po=automaticTransactions(database.po,r);
  const pricing=getEffectivePricing(database.priceBook,r.branch,r.date,r.shiftId);
  const active=database.deposits.filter(d=>d.status!=='rejected');
  const consumed=new Set(active.flatMap(d=>d.carryoverSourceIds));
  const remainder=active.filter(d=>d.anchorKey===keyOf(r)).reduce((sum,d)=>sum+availableCarryover(d,active)+(!consumed.has(d.id)?Math.max(0,d.unexplainedDifference):0),0);
  const pilotCashAwaitingDeposit=r.confirmed?money(Math.max(0,Number(r.actualCashCounted||0)-reservedReportCash(keyOf(r),Number(r.actualCashCounted||0),active))+remainder):undefined;
  if(r.confirmed) return refreshPosReport({...r,pilotCashAwaitingDeposit},database.posRedemptionSync);
  const purchaseRows=r.confirmed?r.purchaseRows:[...(r.purchaseRows||[]).filter(row=>row.source!=='FuelTech CV'),...accountingCashVouchers(database,r)];
  const next={...r,purchaseRows,cvFuelRows:accountingFuelVouchers(database,r),cvImport:{mode:database.mode,source:'FuelTech CV'},pilotCashAwaitingDeposit,prices:{...r.prices,...pricing.prices},poRows:po.transactions.map(t=>({...t,source:'FuelTech Pay'})),onlinePay:{total:pay.total,count:pay.count,source:'FuelTech Pay'},deductions:{...r.deductions,gcash:pay.total,card:0,paymaya:0}};
  if(next.cashReviewState && next.reviewedExpectedCash!==compute(next).expectedCash) {next.cashReviewState='';next.recountRequired=false;}
  return refreshPosReport(refreshFuelCVReview(next,compute(next)),database.posRedemptionSync);
}
function candidate(input,session,readingId) {
  if(!input || !['shift-1','shift-2','shift-3'].includes(input.shiftId)) reject('Invalid report.');
  branchAccess(session,input.branch); datePlus(input.date,0);
  const old=database.reports[keyOf(input)];
  if(!old) reject('Refresh the shift dashboard first.');
  if(old.confirmed) reject('This report is locked. Use the existing Admin correction process.',423);
  assertCorrectionWindow(old);
  if(old.date<stationStartDate(database,old.branch)) reject('Historical reports are read-only.',423);
  if(database.stationStarts&&Date.now()<Date.parse(stationStartDate(database,old.branch)+'T04:00:00+08:00'))reject('Sales reporting begins after the Beginning Setup shift, at 4:00 a.m. Manila time.',423);
  const preceding=old.shiftId==='shift-1'?reportKey(old.branch,dateOffset(old.date,-1),'shift-3'):reportKey(old.branch,old.date,old.shiftId==='shift-2'?'shift-1':'shift-2');
  if(!database.reports[preceding]?.confirmed) reject('Submit the preceding shift before recording this shift.');
  if(!readingId && !cashierRevisionMatches(input,old)) reject('This shift changed on another device. Refresh before saving.',409);
  const template=carryForwardOpenings(old,database.reports);
  const incomingRows=input.pumpRows;
  if(!Array.isArray(incomingRows) || incomingRows.length!==template.pumpRows.length || new Set(incomingRows.map(midShiftPumpKey)).size!==template.pumpRows.length || template.pumpRows.some(base=>!incomingRows.some(row=>midShiftPumpKey(row)===midShiftPumpKey(base)))) reject('Every configured pump/nozzle is required.');
  const rows=template.pumpRows.map(base=>{
    // Dedicated reading saves own these fields; stale desktop drafts cannot overwrite phone readings.
    if(base.readingRevision && base.id!==readingId) return base;
    const row=incomingRows.find(r=>midShiftPumpKey(r)===midShiftPumpKey(base));
    if(!row) reject('Every configured pump/nozzle is required.');
    const photo=database.photos[row.photo_path];
    if(row.photo_path && (!photo || photo.reportKey!==keyOf(old) || photo.rowId!==base.id || photo.changeId)) reject('The photo does not belong to this reading.');
    const ocr=mergeOcrEvidence(base,row);
    return {...base,closing:row.closing,closingEntered:row.closingEntered,closingEntrySource:row.closingEntrySource,photo_path:row.photo_path,...ocr,ocr_was_edited:ocr.ocr_detected_reading!=null && Number(row.closing)!==Number(ocr.ocr_detected_reading),readingConfirmed:row.readingConfirmed,calculated_liters:row.closing===''?null:money(Number(row.closing)-Number(base.opening))};
  });
  const allowed=Object.fromEntries(['cashierName','tankRows','fuelLeakLosses','deliveries','oilSales','actualCashCounted','cashDenominations','notes','coke','pointsIssued','pointsWithdrawn','clientSave'].filter(k=>Object.hasOwn(input,k)).map(k=>[k,input[k]]));
  // Saved deliveries are append-only here. An older desktop draft must not
  // remove stock already recorded by the dedicated delivery action.
  allowed.deliveries=[...(old.deliveries||[]),...(allowed.deliveries||[]).filter(d=>!(old.deliveries||[]).some(saved=>saved.id===d.id))];
  const incomingLeakLossError=validateFuelLeakLosses({...old,...allowed,pumpRows:rows});
  if(incomingLeakLossError) reject(incomingLeakLossError);
  const r=authoritative({...old,...allowed,purchaseRows:old.purchaseRows,pumpRows:rows,confirmed:false,confirmedAt:'',deposits:old.deposits,prices:old.prices,midShiftPriceChanges:old.midShiftPriceChanges,baselineConfirmed:old.baselineConfirmed,baselineMissing:old.baselineMissing,checkDetails:old.checkDetails,cashCountConfirmed:old.cashCountConfirmed,cashReviewState:old.cashReviewState,recountRequired:old.recountRequired,integrationIssues:old.integrationIssues});
  if(!r.posRedemptions?.automatic){
    r.deductions={...r.deductions,cashRedemption:input.deductions?.cashRedemption??r.deductions.cashRedemption,fuelRedemption:input.deductions?.fuelRedemption??r.deductions.fuelRedemption};
    r.pointsWithdrawn=Number(r.deductions.cashRedemption||0)+Number(r.deductions.fuelRedemption||0);
    if(r.cashReviewState&&r.reviewedExpectedCash!==compute(r).expectedCash){r.cashReviewState='';r.recountRequired=false;}
  }
  if(Object.hasOwn(input.deductions||{},'bankCard')) {
    const cardAmount=amount(input.deductions.bankCard);
    if(r.branch!=='Moalboal'&&cardAmount!==0)reject('Debit / credit card payments are enabled only in Moalboal.');
    if(r.branch==='Moalboal') {
      if(Number(r.deductions.bankCard||0)!==cardAmount){r.cashReviewState='';r.recountRequired=false;}
      r.deductions={...r.deductions,bankCard:cardAmount};
    }
  }
  if(old.cashCountConfirmed) {r.actualCashCounted=old.actualCashCounted;r.cashDenominations=old.cashDenominations;}
  else if(r.cashDenominations&&Object.values(r.cashDenominations).some(v=>v!==''&&v!=null)) r.actualCashCounted=denominationTotal(r.cashDenominations);
  else if(r.cashDenominations) r.actualCashCounted='';
  r.initialCashDenominations=old.initialCashDenominations;
  r.depositCoverage=old.depositCoverage;
  r.midShiftBasePrices=old.midShiftBasePrices;
  if(r.posRedemptions?.automatic&&r.posRedemptions.pointsStatus!=='verified')r.pointsIssued=old.pointsIssued;
  amount(r.oilSales||0);
  const deliveries=[];
  for(const delivery of r.deliveries||[]) {
    const issue=tankDeliveryError(delivery);if(issue)reject(issue);
    if(deliveries.some(d=>sameTankDelivery(d,delivery)))reject('This delivery is already listed.');
    deliveries.push(delivery);
    if(Object.values(database.reports).some(other=>other.branch===r.branch&&keyOf(other)!==keyOf(r)&&(other.deliveries||[]).some(d=>sameTankDelivery(d,delivery,{sameDate:other.date===r.date})))) reject('This delivery is already recorded in another shift.');
  }
  r.tankRows=template.tankRows.map(base=>{
    const row=(r.tankRows||[]).find(t=>t.id===base.id)||base;
    for(const value of [row.actualDip,row.pullOut,row.calibration]) if(value!==''&&value!=null) amount(value);
    return {...row,opening:base.opening,product:base.product,tank:base.tank,delivery:(r.deliveries||[]).filter(d=>d.product===base.product).reduce((sum,d)=>sum+Number(d.liters),0)};
  });
  const leakLossError=validateFuelLeakLosses(r);
  if(leakLossError) reject(leakLossError);
  for(const row of r.purchaseRows||[]) {
    if(!['OPEX','Personal','Personnel','Construction'].includes(row.category) || !String(row.item||'').trim()) continue; // drafts can be incomplete
    amount(row.amount);
  }
  for(const value of Object.values(r.deductions)) { if(value!=='' && value!=null) amount(value); }
  return r;
}
function cashierRevisionMatches(input,old) {
  const incoming=Number(input?.pilotRevision||0),current=Number(old.pilotRevision||0);
  // Phone and POS imports own separate fields. A desktop can retain its edits
  // across those saves, but must never cross another cash/draft/manager edit.
  const lastEdit=Number(old.pilotLastNonReadingRevision??current);
  return incoming===current || (incoming>=lastEdit && incoming<current);
}
function hasDepositCoverage(report) {
  return database.deposits.some(d=>d.status!=='rejected'&&d.coveredReportKeys.includes(keyOf(report)));
}
function assertCorrectionWindow(report) {
  if(report.correctionRequest?.status==='approved'&&!(Date.parse(report.correctionRequest.expiresAt||'')>Date.now())) reject('This correction approval expired. Ask admin to approve it again.',423);
  if(report.correctionRequest?.status==='rejected'&&!report.confirmed) reject('This correction was rejected. Request a new admin approval before editing.',423);
}
function isBeginningSetup(report) {
  return Boolean(report?.baselineReport&&report.branch!=='Liloan'&&isStationOpening(database,report));
}
function openingPhotoComplete(report,row) {
  const photo=database.photos[row.photo_path];
  return readingComplete(row)&&Number(row.opening)===Number(row.closing)
    &&photo?.reportKey===keyOf(report)&&photo.rowId===row.id&&!photo.changeId;
}
function storeReport(r,session,action,details={}) {
  r=refreshPosReport(r,database.posRedemptionSync);
  if(r.date<stationStartDate(database,r.branch)&&!(r.baselineReport&&isStationOpening(database,r))) reject('Historical reports are read-only in the pilot.',423);
  r.pilot=true; r.pilotRevision=Number(database.reports[keyOf(r)]?.pilotRevision||0)+1;
  const previous=database.reports[keyOf(r)];
  r.pilotLastNonReadingRevision=action==='pump-reading-saved'
    ? Number(previous?.pilotLastNonReadingRevision??previous?.pilotRevision??0)
    : r.pilotRevision;
  r.pilotCashRevision=Number(previous?.pilotCashRevision||0)+(['cash-confirm','cash-recount','correction-approved'].includes(action)?1:0);
  r.serverMeta={...r.serverMeta,reportId:r.serverMeta?.reportId||(r.confirmed?randomUUID():''),savedAt:stamp()};
  database.reports[keyOf(r)]=r;
  audit(action,session,{...details,reportKey:keyOf(r)}); save();
  return {ok:true,report:r,reportId:r.serverMeta.reportId};
}
function coverage(branch,date) {
  return depositCoverage(Object.values(database.reports).filter(r=>r.date>=stationStartDate(database,r.branch)).map(r=>({key:keyOf(r),branch:r.branch,date:r.date,shiftId:r.shiftId,cash:Number(r.actualCashCounted||0),confirmed:!!r.confirmed})),database.deposits,branch,date,database.noDepositDays);
}
function exposeReport(report,session) {
  const r=structuredClone(authoritative(report));
  if(session.role!=='Approver')r.pendingVouchers=pendingVouchersForReport(database,r);
  const sourceIssues=(database.sourceAlerts||[]).filter(a=>(a.reportKey===keyOf(r)||a.reportKeys?.includes(keyOf(r))));
  if(sourceIssues.length) r.checkDetails=[...(r.checkDetails||[]),...sourceIssues.filter(a=>!(r.checkDetails||[]).some(i=>i.id===a.id))];
  if(r.date>=stationStartDate(database,r.branch)) r.pilot=true;
  if(r.confirmed) {
    r.checkDetails=(r.checkDetails||[]).filter(i=>!['BANK_DEPOSIT','BANK_VERIFIER'].includes(i.category));
    for(const d of database.deposits.filter(d=>d.anchorKey===keyOf(r))) {
      if(d.status!=='rejected'&&d.unexplainedDifference!==0) r.checkDetails.push({category:'BANK_DEPOSIT',detail:`Deposit ${d.reference}: unexplained difference ${d.unexplainedDifference.toFixed(2)}.`});
      if(d.status==='rejected') r.checkDetails.push({category:'BANK_VERIFIER',detail:`Deposit ${d.reference} rejected: ${d.rejectionReason}.`});
    }
    r.checkDetails.push(...managerDepositCoverageIssues(r,database));
    r.checkCategories=[...new Set(r.checkDetails.map(i=>i.category))];r.checkRequired=!!r.checkDetails.length;
  }
  if(session.role==='Cashier') {
    delete r.checkDetails; delete r.cashVarianceReason;
    if(r.managerReconciliation) {
      r.managerReconciliation={...r.managerReconciliation};
      for(const field of ['original','photoConflicts','cvMatchingNotes','manualVariance','manualCVDetails']) delete r.managerReconciliation[field];
    }
    r.integrationIssues=(r.integrationIssues||[]).map(i=>({category:i.category,detail:'Issue reported for Admin review.'}));
  }
  return r;
}
function validatePricePhotos(report,change) {
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(change.effectiveTime)||amount(change.newPrice)<=0) reject('Enter the price-change time and new price.');
  const hour=Number(change.effectiveTime.slice(0,2)),shift=hour<4||hour>=22?'shift-3':hour<13?'shift-1':'shift-2';
  if(shift!==report.shiftId) reject('The price-change time belongs to a different shift.');
  const rows=report.pumpRows.filter(row=>row.product===change.product);
  if(!rows.length) reject('No configured nozzles for this product.');
  for(const row of rows) {
    const evidence=change.readingPhotos?.[midShiftPumpKey(row)];
    const photo=database.photos[evidence?.photo_path];
    const value=midShiftReadingValue(change,row);
    if(!evidence?.readingConfirmed||!photo||photo.reportKey!==keyOf(report)||photo.rowId!==row.id||photo.changeId!==change.id||photo.effectiveTime!==change.effectiveTime||photo.product!==change.product||value===''||!Number.isFinite(Number(value))||Number(value)<Number(row.opening)||(row.closingEntered&&Number(value)>Number(row.closing))) reject('Photograph and confirm every affected nozzle with a valid price-change reading.');
  }
}
function validatePriceReadingOrder(report,change) {
  const changes=report.midShiftPriceChanges.filter(c=>c.confirmedAt||c.id===change.id);
  const issues=midShiftReadingIssues({...report,midShiftPriceChanges:changes});
  if(issues.length)reject(issues[0]);
}
    if(route==='/api/realtime/config') return send({enabled:false});
    if(route==='/api/reports/lease') return send({ok:true,editors:[],activeEditors:[],acquired:true});
    if(route==='/api/store/load' || route==='/api/prices/load') {
      const allowed=branch=>['Admin','Approver'].includes(session.role)||branch===session.branch;
      const priceRows=Object.entries(database.priceBook).filter(([b])=>allowed(b)).flatMap(([branch,book])=>Object.entries(book).map(([date,prices])=>({branch,effective_date:date.split('__')[0],coverage:date.includes('__')?'Shift':'Daily',shift_id:date.split('__')[1]||'daily',prices,updated_at:stamp()})));
      const reportRows=Object.values(database.reports).filter(r=>allowed(r.branch)&&(!options.storeChangedKeys||options.storeChangedKeys.has(keyOf(r)))).map(r=>({report_key:keyOf(r),branch:r.branch,report_date:r.date,shift_id:r.shiftId,data:exposeReport(r,session),updated_at:stamp()}));
      if(input.paged){
        if(typeof (input.after||'')!=='string')reject('Invalid report page.');
        const sorted=reportRows.filter(row=>row.report_key>(input.after||'')).sort((a,b)=>a.report_key<b.report_key?-1:a.report_key>b.report_key?1:0);
        return send(storePage(sorted,input.after?[]:priceRows));
      }
      return send({ok:true,priceRows,reportRows});
    }
    if(route==='/api/demo/delivery-save'){
      requireRole(session,'Cashier');
      const old=database.reports[input.reportKey];if(!old)reject('Open the saved shift before recording a delivery.');
      branchAccess(session,old.branch);assertCorrectionWindow(old);
      if(old.confirmed||old.baselineReport||old.baselineMissing||old.date<stationStartDate(database,old.branch))reject('This shift is locked. Open the current shift to record a delivery.',423);
      const raw=input.delivery||{},isLoad=Object.hasOwn(raw,'items');
      const delivery=isLoad?newTankDeliveryLoad(raw,raw.id):newTankDelivery(raw,raw.id);
      const issue=isLoad?tankDeliveryLoadError(delivery):tankDeliveryError(delivery);if(issue)reject(issue);
      const entries=isLoad?deliveryLoadEntries(delivery):[delivery];
      const previousNonReadingRevision=Number(old.pilotLastNonReadingRevision??old.pilotRevision??0);
      const existing=(old.deliveries||[]).filter(d=>(d.deliveryId||d.id)===delivery.id);
      if(existing.length){
        if(existing.length!==entries.length||entries.some(entry=>!existing.some(saved=>saved.id===entry.id&&['driverName','product','liters','time'].every(k=>String(saved[k])===String(entry[k])))))reject('This saved delivery changed. Refresh before trying again.',409);
        return send({ok:true,alreadyRecorded:true,report:exposeReport(old,session),previousNonReadingRevision});
      }
      if(Object.values(database.reports).some(other=>other.branch===old.branch&&(other.deliveries||[]).some(d=>entries.some(entry=>sameTankDelivery(d,entry,{sameDate:other.date===old.date})))))reject('This delivery is already recorded. Check the saved deliveries before adding it again.',409);
      const r={...old,deliveries:[...(old.deliveries||[]),...entries]};
      r.tankRows=old.tankRows.map(row=>({...row,delivery:r.deliveries.filter(d=>d.product===row.product).reduce((sum,d)=>sum+Number(d.liters),0)}));
      const saved=storeReport(r,session,'tank-delivery-saved',{delivery});
      return send({...saved,report:exposeReport(saved.report,session),previousNonReadingRevision});
    }
    if(route==='/api/reports/save') {
      requireRole(session,'Cashier','Manager','Admin');
      let old=database.reports[keyOf(input.report||{})];
      if(isBeginningSetup(old)) {
        requireRole(session,'Cashier'); branchAccess(session,old.branch);
        if(old.confirmed) reject('Opening setup is already confirmed.',423);
        if(!cashierRevisionMatches(input.report,old)) reject('Opening setup changed on another device. Refresh before saving.',409);
        const r=structuredClone(old), source=input.report;
        r.pumpRows=r.pumpRows.map(base=>{const row=(source.pumpRows||[]).find(v=>v.id===base.id);if(!row)reject('Every configured nozzle is required.');return base.readingRevision?base:{...base,opening:row.opening,closing:row.opening,closingEntered:row.opening!==''&&row.opening!=null,closingEntrySource:'baseline'};});
        r.tankRows=r.tankRows.map(base=>{const row=(source.tankRows||[]).find(v=>v.id===base.id);if(!row)reject('Every tank is required.');return {...base,opening:row.opening,actualDip:row.opening};});
        r.coke={...r.coke,beginning:source.coke?.beginning??'',ending:source.coke?.beginning??''};
        r.cashierName=String(source.cashierName||'').trim();
        if(source.baselineConfirmed){
          if(Date.now()<Date.parse(old.openingSetupRequiredAt))reject('Beginning Setup opens November 4 at 10:00 p.m. Manila time.',423);
          for(const row of r.pumpRows)amount(row.opening);
          if(r.pumpRows.some(row=>!openingPhotoComplete(r,row)))reject('Photograph and confirm every starting pump reading before confirming Opening Setup.');
          for(const row of r.tankRows)amount(row.opening);
          if(!Number.isInteger(amount(r.coke.beginning)))reject('Enter a whole-number Coke count.');
          if(!r.cashierName)reject('Enter the cashier name.');
          Object.assign(r,{confirmed:true,confirmedAt:stamp(),baselineConfirmed:true,baselineMissing:false,baselineReady:true,openingSetupComplete:true,baselineConfirmedAt:stamp()});
        }
        return send(storeReport(r,session,source.baselineConfirmed?'opening-setup-confirmed':'opening-setup-saved'));
      }
      if(input.report?.date<stationStartDate(database,input.report?.branch)) reject('Historical reports are read-only.',423);
      if(session.role==='Admin'&&input.report.correctionRequest?.status==='approved'
        &&old?.correctionRequest?.id===input.report.correctionRequest.id
        &&old.correctionRequest.status==='approved'&&Date.parse(old.correctionRequest.expiresAt||'')>Date.now()) return send({ok:true,alreadyApproved:true,report:exposeReport(old,session)});
      const decision=session.role==='Admin'&&['approved','rejected'].includes(input.report?.correctionRequest?.status);
      // A decision changes only approval metadata. Source imports or phone saves
      // can advance the report revision without changing the request being reviewed.
      if(decision&&(!old?.correctionRequest?.id||old.correctionRequest.id!==input.report.correctionRequest.id||old.correctionRequest.requestedAt!==input.report.correctionRequest.requestedAt)) rejectStaleCorrection('This correction request changed. Refresh before deciding.');
      if(old && !decision && !(session.role==='Cashier'&&input.operation!=='request-correction'
        ? cashierRevisionMatches(input.report,old)
        : Number(input.report?.pilotRevision||0)===Number(old.pilotRevision||0))) reject('This shift changed on another device. Refresh before saving.',409);
      if(input.operation==='request-correction') {
        if(old?.correctionRequest?.status==='approved'&&Date.parse(old.correctionRequest.expiresAt||'')>Date.now()) return send({ok:true,alreadyApproved:true,report:exposeReport(old,session)});
        branchAccess(session,old?.branch); const r={...old,correctionRequest:{...input.report.correctionRequest,status:'pending'}};
        return send(storeReport(r,session,'correction-requested'));
      }
      if(session.role==='Admin') {
        if(!old) reject('Report not found.');
        if(input.report.correctionRequest?.status==='approved') {
          const request=old.correctionRequest;
          if(!request?.id||request.id!==input.report.correctionRequest.id||!['pending','approved'].includes(request.status)) rejectStaleCorrection('This correction request changed. Refresh before approving.');
          const covered=hasDepositCoverage(old);
          const approved={...request,status:'approved',approvedAt:stamp(),expiresAt:new Date(Date.now()+24*60*60*1000).toISOString(),rejectedAt:'',completedAt:'',previousConfirmedAt:old.confirmedAt||request.previousConfirmedAt||''};
          return send(storeReport({...old,confirmed:false,confirmedAt:'',correctionRequest:approved,correctionCashLocked:covered,cashCountConfirmed:covered?old.cashCountConfirmed:false,cashReviewState:'',recountRequired:false},session,'correction-approved'));
        }
        if(input.report.correctionRequest?.status==='rejected') {
          const request=old.correctionRequest;
          if(!request?.id||request.id!==input.report.correctionRequest.id||!['pending','approved'].includes(request.status)) rejectStaleCorrection('This correction request changed. Refresh before rejecting.');
          return send(storeReport({...old,correctionRequest:{...request,status:'rejected',rejectedAt:stamp(),expiresAt:''}},session,'correction-rejected'));
        }
        reject('Use the dedicated pilot actions for this change.');
      }
      if(session.role==='Manager') {
        branchAccess(session,input.report?.branch);
        if(!old) {
          datePlus(input.report.date,0);
          if(!['shift-1','shift-2','shift-3'].includes(input.report.shiftId)) reject('Invalid shift.');
          const prices=getEffectivePricing(database.priceBook,input.report.branch,input.report.date,input.report.shiftId).prices;
          old=carryForwardOpenings(createReport(input.report.branch,input.report.date,prices,input.report.shiftId),database.reports);
        }
        if(old.confirmed) reject('Submitted reports require the existing Admin correction process.',423);
        old=carryForwardOpenings(old,database.reports);
        const incoming=input.report.midShiftPriceChanges||[];
        if(!Array.isArray(incoming)||incoming.some(c=>!c.id)||new Set(incoming.map(c=>c.id)).size!==incoming.length) reject('Invalid price changes.');
        const newlyConfirmed=[];
        const changes=incoming.map(c=>{
          if(!['Premium','Regular','Diesel'].includes(c.product)) reject('Unknown fuel product.');
          const previous=old.midShiftPriceChanges?.find(p=>p.id===c.id);
          const sameContext=previous?.product===c.product&&previous?.effectiveTime===c.effectiveTime;
          const next={id:c.id,product:c.product,effectiveTime:c.effectiveTime,newPrice:c.newPrice,photoRequired:previous?!!previous.photoRequired:true,readings:sameContext?(previous.readings||{}):{},readingPhotos:sameContext?(previous.readingPhotos||{}):{},confirmedAt:''};
          if(sameContext&&previous.newPrice===c.newPrice) next.confirmedAt=previous.confirmedAt||'';
          if(c.confirmedAt) {
            if(next.photoRequired)validatePricePhotos({...old,midShiftPriceChanges:[next]},next);
            if(!next.confirmedAt){next.confirmedAt=stamp();newlyConfirmed.push(next.product);}
          }
          return next;
        });
        const changed=JSON.stringify(changes)!==JSON.stringify(old.midShiftPriceChanges||[]);
        for(const change of changes.filter(c=>c.confirmedAt))validatePriceReadingOrder({...old,midShiftPriceChanges:changes},change);
        const result=storeReport({...old,midShiftPriceChanges:changes,midShiftBasePrices:old.midShiftBasePrices||old.prices,...(changed?{cashReviewState:'',recountRequired:false}:{})},session,'mid-shift-price-change');
        if(newlyConfirmed.length){
          const carried=carryMidShiftPrices(database,result.report,newlyConfirmed);
          syncUnsubmittedPrices(database,result.report.branch,result.report.date,result.report.shiftId);
          result.dailyPricePatch=carried.patch;result.priceDate=result.report.date;
          audit('mid-shift-price-carried-forward',session,{reportKey:keyOf(result.report),prices:carried.prices,products:newlyConfirmed});
        }
        return send(result);
      }
      const r=candidate(input.report,session);
      if(input.operation==='submit') {
        if(r.posRedemptions?.automatic&&(r.posRedemptions.status!=='verified'||!r.posRedemptions.verifiedAt||Date.now()-Date.parse(r.posRedemptions.verifiedAt)>120000))reject('Verify automatic POS redemptions before submission.');
        const leakLossError=validateFuelLeakLosses(r,{requireNotes:true});
        if(leakLossError) reject(leakLossError);
        if(r.reviewedExpectedCash!==compute(r).expectedCash) reject('Cash or source totals changed. Check cash reconciliation again.');
        if((database.sourceAlerts||[]).some(a=>(a.reportKey===keyOf(r)||a.reportKeys?.includes(keyOf(r))))) reject('A source voucher changed or was cancelled. Admin must review before submission.');
        if(!database.sourcesVerifiedAt || Date.now()-Date.parse(database.sourcesVerifiedAt)>120000) reject('Verify online payment, PO and CV records before submission.');
        if(!r.cashCountConfirmed || !r.cashReviewState || (r.recountRequired && r.cashReviewState!=='final')) reject('Confirm your cash and complete the recount first.');
        if(r.pumpRows.some(row=>!readingComplete(row))) reject('Complete all pump/nozzle photos and confirmed readings before submitting.');
        if(!String(r.cashierName||'').trim()) reject('Enter the cashier name.');
        for(const row of r.purchaseRows||[]) if(!['OPEX','Personal','Personnel','Construction'].includes(row.category)||!String(row.item||'').trim()||amount(row.amount)<=0) reject('Complete the category, note and amount for each deduction.');
        if(r.pumpRows.some(row=>Number(r.prices[row.product])<=0)) reject('Manager fuel prices are missing.');
        for(const change of (r.midShiftPriceChanges||[]).filter(midShiftChangeHasDetails)) {
          if(change.photoRequired){validatePricePhotos(r,change);if(!change.confirmedAt)reject('Manager must confirm the price change before submission.');}
          if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(change.effectiveTime)||Number(change.newPrice)<=0) reject('Complete the manager mid-shift price change before submission.');
          if(r.pumpRows.filter(row=>row.product===change.product).some(row=>midShiftReadingValue(change,row)===''||Number(midShiftReadingValue(change,row))<Number(row.opening)||Number(midShiftReadingValue(change,row))>Number(row.closing))) reject('Review all readings for the mid-shift price change.');
        }
        const priceReadingIssues=midShiftReadingIssues(r);
        if(priceReadingIssues.length)reject(priceReadingIssues[0]);
        const zeroResult=compute(r);
        if(requiresZeroSalesConfirmation(r,zeroResult)) {
          const reviewKey=zeroSalesReviewKey(r,zeroResult);
          if(input.report.zeroSalesAcknowledged!==true||input.report.zeroSalesReviewKey!==reviewKey)reject('This report shows zero sales. Confirm the zero-sales statement in the submission dialog after checking the saved pump readings.');
          r.zeroSalesConfirmation={confirmedAt:stamp(),role:session.role,cashierName:r.cashierName,reviewKey};
          audit('zero-sales-confirmed',session,{reportKey:keyOf(r),cashierName:r.cashierName});
        }else if(r.zeroSalesConfirmation)r.zeroSalesConfirmation=null;
        r.confirmed=true;r.confirmedAt=stamp();r.checkDetails=reportIssues(r,compute(r).cashVariance);r.checkCategories=[...new Set(r.checkDetails.map(i=>i.category))];r.checkRequired=!!r.checkDetails.length;
        if(r.correctionRequest?.status==='approved') r.correctionRequest={...r.correctionRequest,status:'completed',completedAt:stamp()};
      }
      const previousRows=old?.pumpRows||[];
      for(const row of r.pumpRows) if(row.readingConfirmed && !previousRows.find(p=>p.id===row.id&&p.readingConfirmed&&p.closing===row.closing&&p.photo_path===row.photo_path)) audit(row.ocr_was_edited?'ocr-reading-edited':'pump-reading-confirmed',session,{reportKey:keyOf(r),rowId:row.id,ocr:row.ocr_detected_reading,final:row.closing});
      if(JSON.stringify(old?.deliveries||[])!==JSON.stringify(r.deliveries||[])) audit('tank-delivery-changed',session,{reportKey:keyOf(r),before:old?.deliveries||[],after:r.deliveries||[]});
      if(JSON.stringify(old?.fuelLeakLosses||[])!==JSON.stringify(r.fuelLeakLosses||[])) audit('fuel-leak-loss-changed',session,{reportKey:keyOf(r),before:old?.fuelLeakLosses||[],after:r.fuelLeakLosses||[]});
      if(JSON.stringify(old?.purchaseRows||[])!==JSON.stringify(r.purchaseRows||[])) audit('manual-deduction-changed',session,{reportKey:keyOf(r),before:old?.purchaseRows||[],after:r.purchaseRows||[]});
      return send(storeReport(r,session,input.operation==='submit'?'report-submitted':'draft-saved'));
    }
    if(route==='/api/demo/cash-confirm' || route==='/api/demo/cash-check' || route==='/api/demo/cash-recount') {
      requireRole(session,'Cashier');
      let r;
      if(route.endsWith('cash-confirm')) {
        // This action owns only the physical count, not the incoming desktop draft.
        // Keep current pump photos, prices, source records and other saved fields.
        const old=database.reports[keyOf(input.report||{})];
        if(!old)reject('Refresh the shift dashboard first.');
        branchAccess(session,input.report?.branch);
        const total=denominationTotal(input.denominations);
        if(old.cashCountConfirmed) {
          const same=old.cashDenominations&&CASH_DENOMINATIONS.every(d=>Number(old.cashDenominations[d]||0)===Number(input.denominations[d]||0));
          if(same&&Number(old.actualCashCounted)===total)return send({ok:true,alreadyConfirmed:true,report:exposeReport(old,session)});
          reject('Physical cash was already confirmed on another device. Refresh to view the saved count; it cannot be replaced.',409);
        }
        if(input.report?.cashCountConfirmed||Number(input.report?.pilotCashRevision||0)!==Number(old.pilotCashRevision||0))reject('The cash confirmation changed. Refresh the saved shift before confirming.',409);
        r=candidate(old,session);
        r.actualCashCounted=total;r.cashDenominations=input.denominations;r.initialCashDenominations=input.denominations;r.cashCountConfirmed=true;
      } else r=candidate(input.report,session);
      if(route.endsWith('cash-check')) {
        if(r.posRedemptions?.automatic&&(r.posRedemptions.status!=='verified'||!r.posRedemptions.verifiedAt||Date.now()-Date.parse(r.posRedemptions.verifiedAt)>120000))reject('Verify automatic POS redemptions before checking cash.');
        if(!r.cashCountConfirmed || r.pumpRows.some(row=>!readingComplete(row))) reject('Confirm cash and complete all readings first.');
        if(r.cashReviewState && r.reviewedExpectedCash===compute(r).expectedCash) return send({ok:true,needsRecount:!!r.recountRequired,report:exposeReport(r,session)});
        r.reviewedExpectedCash=compute(r).expectedCash;
        r.recountRequired=!hasDepositCoverage(r)&&cashNeedsRecount(Number(r.actualCashCounted),compute(r).expectedCash);r.cashReviewState=r.recountRequired?'recount':'checked';
      }
      if(route.endsWith('cash-recount')) { if(hasDepositCoverage(r)) reject('This cash count is already covered by a deposit. Correct the deposit coverage before changing cash.',409);if(r.cashReviewState!=='recount') reject('Recount is not available.');r.actualCashCounted=denominationTotal(input.denominations);r.cashDenominations=input.denominations;r.cashReviewState='final'; }
      const saved=storeReport(r,session,route.split('/').at(-1));
      return send({ok:true,needsRecount:!!saved.report.recountRequired,report:exposeReport(saved.report,session)});
    }
    if(route==='/api/demo/pump-report' || route==='/api/demo/pump-reading') {
      requireRole(session,'Cashier');
      const old=database.reports[input.reportKey];branchAccess(session,old?.branch);
      if(route.endsWith('pump-report')) return send({ok:true,report:exposeReport(isBeginningSetup(old)?old:carryForwardOpenings(old,database.reports),session)});
      if(old.confirmed) reject('Submitted report is locked.',423);
      const base=old.pumpRows.find(row=>row.id===input.row?.id);
      if(!base) reject('Unknown nozzle.');
      if(Number(input.revision)!==Number(base.readingRevision||0)) reject('This nozzle changed on another device. Refresh the readings before trying again.',409);
      if(isBeginningSetup(old)) {
        const photo=database.photos[input.row.photo_path];
        if(input.row.photo_path!==base.photo_path||!photo||photo.reportKey!==keyOf(old)||photo.rowId!==base.id||photo.changeId)reject('The photo does not belong to this starting reading.');
        const r=structuredClone(old),row=r.pumpRows.find(p=>p.id===base.id);
        const value=input.row.readingConfirmed?amount(input.row.closing):'';
        const ocr=mergeOcrEvidence(base,input.row);
        Object.assign(row,{opening:value,closing:value,closingEntered:!!input.row.readingConfirmed,closingEntrySource:'baseline',
          photo_path:input.row.photo_path,...ocr,ocr_was_edited:ocr.ocr_detected_reading!=null&&value!==Number(ocr.ocr_detected_reading),
          readingConfirmed:!!input.row.readingConfirmed,confirmed_closing_reading:input.row.readingConfirmed?value:null,
          calculated_liters:input.row.readingConfirmed?0:null,readingRevision:Number(base.readingRevision||0)+1});
        r.baselineReady=false;
        audit('opening-reading-saved',session,{reportKey:keyOf(r),rowId:row.id,photo_path:row.photo_path,ocr:row.ocr_detected_reading,ocr_result:row.ocr_result,final:value,confirmed:row.readingConfirmed});
        return send(storeReport(r,session,'pump-reading-saved'));
      }
      if(old.baselineReport||old.baselineMissing) reject('Complete starting-opening setup on desktop first.');
      const r=candidate({...old,pumpRows:old.pumpRows.map(row=>row.id===base.id?{...row,...input.row}:row)},session,base.id);
      const row=r.pumpRows.find(row=>row.id===base.id);
      if(row.readingConfirmed && (!readingComplete(row)||readingWarning(row).blocked)) reject('A valid photo and closing reading are required.');
      row.readingRevision=Number(base.readingRevision||0)+1;
      // A changed reading requires a fresh final cash check.
      r.cashReviewState='';r.recountRequired=false;
      audit(row.ocr_was_edited?'ocr-reading-edited':'pump-reading-saved',session,{reportKey:keyOf(r),rowId:row.id,photo_path:row.photo_path,ocr:row.ocr_detected_reading,ocr_result:row.ocr_result,final:row.closing});
      const saved=storeReport(r,session,'pump-reading-saved');
      return send({ok:true,report:exposeReport(saved.report,session)});
    }
    if(route==='/api/demo/midshift-reading') {
      requireRole(session,'Manager');const old=database.reports[input.reportKey];branchAccess(session,old?.branch);
      if(old.confirmed) reject('Submitted report is locked.',423);
      const r=carryForwardOpenings(structuredClone(old),database.reports);
      const change=r.midShiftPriceChanges?.find(c=>c.id===input.changeId);
      if(!change||change.product!==input.product||change.effectiveTime!==input.effectiveTime) reject('The price-change details changed. Refresh before taking another photo.',409);
      const row=r.pumpRows.find(p=>midShiftPumpKey(p)===midShiftPumpKey(input.row||{})&&p.product===change.product);
      if(!row) reject('This nozzle is not affected by the price change.');
      const key=midShiftPumpKey(row),previous=change.readingPhotos?.[key];
      if(Number(input.revision)!==Number(previous?.readingRevision||0)) reject('This price-change photo changed on another device. Refresh and try again.',409);
      const photo=database.photos[input.row.photo_path];
      if(!photo||photo.reportKey!==keyOf(r)||photo.rowId!==row.id||photo.changeId!==change.id||photo.product!==change.product||photo.effectiveTime!==change.effectiveTime) reject('This photo does not belong to this price-change reading.');
      const value=input.row.readingConfirmed?amount(input.row.closing):'';
      if(input.row.readingConfirmed&&(value<Number(row.opening)||(row.closingEntered&&value>Number(row.closing)))) reject('Price-change reading must be between opening and the confirmed closing.');
      const ocr=mergeOcrEvidence(previous,input.row);
      const evidence={photo_path:input.row.photo_path,readingConfirmed:!!input.row.readingConfirmed,readingRevision:Number(previous?.readingRevision||0)+1,...ocr,ocr_was_edited:ocr.ocr_detected_reading!=null&&value!==Number(ocr.ocr_detected_reading)};
      change.readingPhotos={...change.readingPhotos,[key]:evidence};change.readings={...change.readings,[key]:value};change.confirmedAt='';change.photoRequired=true;
      r.cashReviewState='';r.recountRequired=false;
      audit('price-change-reading-saved',session,{reportKey:keyOf(r),changeId:change.id,rowId:row.id,photo_path:evidence.photo_path,final:value,ocr:evidence.ocr_detected_reading,ocr_result:evidence.ocr_result});
      return send(storeReport(r,session,'price-change-photo-saved'));
    }
    if(route==='/api/demo/photo') {
      requireRole(session,input.changeId?'Manager':'Cashier');const r=database.reports[input.reportKey];branchAccess(session,r?.branch);
      if(r.confirmed) reject('Submitted report is locked.',423);
      assertCorrectionWindow(r);
      const photoRow=r.pumpRows.find(row=>input.changeId?midShiftPumpKey(row)===input.pumpKey:row.id===input.rowId);
      if(!photoRow) reject('Unknown nozzle.');
      const change=input.changeId?r.midShiftPriceChanges?.find(c=>c.id===input.changeId):null;
      if(input.changeId&&(!change||!change.effectiveTime||photoRow.product!==change.product)) reject('Save the product and price-change time before taking photos.');
      const previous=change?change.readingPhotos?.[midShiftPumpKey(photoRow)]:photoRow;
      const previousPhoto=previous?.photo_path,previousOcr=previous?.ocr_detected_reading;
      if(input.replaceReading&&Number(input.revision)!==Number(previous?.readingRevision||0))reject('This reading changed on another device. Refresh before replacing its photo.',409);
      if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(input.data||'')) reject('Use a JPEG photo.');
      const image=Buffer.from(input.data.split(',')[1],'base64');
      if(image.length>2*1024*1024 || image[0]!==255 || image[1]!==216) reject('Invalid or oversized photo.');
      const id=mutationId, photoPath='/api/pilot/photo?id='+id;
      const objectPath=database.mode+'/'+r.branch+'/'+id+'.jpg';
      await uploadPhoto(objectPath,image,{reportKey:keyOf(r),rowId:photoRow.id,branch:r.branch,
        readingRevision:Number(previous?.readingRevision||0),uploadedAt:stamp(),
        ...(change?{changeId:change.id,product:change.product,effectiveTime:change.effectiveTime}: {})});
      database.photos[photoPath]={reportKey:input.reportKey,rowId:photoRow.id,branch:r.branch,file:objectPath,...(change?{changeId:change.id,product:change.product,effectiveTime:change.effectiveTime}: {})};
      let readingRevision;
      if(input.replaceReading){
        readingRevision=Number(previous?.readingRevision||0)+1;
        const cleared={photo_path:photoPath,readingConfirmed:false,closingEntered:false,closing:'',ocr_detected_reading:null,ocr_result:{status:'pending',version:TOTALIZER_VERSION},ocr_was_edited:false,readingRevision};
        if(change){
          const pumpKey=midShiftPumpKey(photoRow);
          change.readingPhotos={...change.readingPhotos,[pumpKey]:cleared};change.readings={...change.readings,[pumpKey]:''};change.confirmedAt='';change.photoRequired=true;
        }else {
          Object.assign(photoRow,cleared,{calculated_liters:null});
          if(isBeginningSetup(r)){photoRow.opening='';r.baselineReady=false;}
        }
        r.cashReviewState='';r.recountRequired=false;
        storeReport(r,session,change?'price-change-photo-saved':'pump-reading-saved');
      }
      audit('pump-photo-uploaded',session,{reportKey:input.reportKey,rowId:photoRow.id,photo_path:photoPath,previousPhoto,previousOcr,...(change?{changeId:change.id}: {})});save();return send({ok:true,photo_path:photoPath,...(input.replaceReading?{readingRevision,report:exposeReport(database.reports[input.reportKey],session)}: {})});
    }
    if(route==='/api/demo/issue') {
      requireRole(session,'Cashier');const r=candidate(input.report,session);
      if(!['ONLINE_PAY','PO','REDEMPTION','OTHER'].includes(input.category)||!String(input.detail||'').trim()) reject('Describe the issue.');
      r.integrationIssues=[...(r.integrationIssues||[]),{category:input.category,detail:String(input.detail).slice(0,500)}];return send(storeReport(r,session,'integration-issue-reported'));
    }
    if(route==='/api/demo/midshift-confirm') {
      requireRole(session,'Manager');
      const old=database.reports[input.reportKey];
      if(!old)reject('Refresh the shift first.');
      branchAccess(session,old.branch);
      if(old.confirmed||old.date<stationStartDate(database,old.branch))reject('Submitted or historical reports cannot be changed here.',423);
      const change=old.midShiftPriceChanges?.find(c=>c.id===input.changeId);
      if(!change)reject('This price change no longer exists. Refresh first.',409);
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(change.effectiveTime)||amount(change.newPrice)<=0)reject('Enter the price-change time and new price.');
      if(change.photoRequired)validatePricePhotos(old,change);
      validatePriceReadingOrder(old,change);
      if(change.confirmedAt)return send({ok:true,report:old,alreadyConfirmed:true,priceDate:old.date,dailyPricePatch:confirmedDailyPricePatch(database,old.branch,old.date,[change.product])});
      const report={...old,midShiftBasePrices:old.midShiftBasePrices||old.prices,midShiftPriceChanges:old.midShiftPriceChanges.map(c=>c.id===change.id?{...c,confirmedAt:stamp()}:c),cashReviewState:'',recountRequired:false};
      const result=storeReport(report,session,'mid-shift-price-confirmed');
      const carried=carryMidShiftPrices(database,result.report,[change.product]);
      syncUnsubmittedPrices(database,old.branch,old.date,old.shiftId);
      audit('mid-shift-price-carried-forward',session,{reportKey:input.reportKey,changeId:change.id,product:change.product,effectiveTime:change.effectiveTime,prices:carried.prices});
      return send({...result,priceDate:old.date,dailyPricePatch:carried.patch});
    }
    if(route==='/api/prices/save') {
      if(input.date<database.startDate) reject('Historical prices are read-only.',423);
      requireRole(session,'Manager','Admin');branchAccess(session,input.branch);datePlus(input.date,0);
      const key=input.coverage==='Shift'?`${input.date}__${input.shiftId}`:input.date;
      if(!['Daily','Shift'].includes(input.coverage)||(input.coverage==='Shift'&&!['shift-1','shift-2','shift-3'].includes(input.shiftId)))reject('Invalid price coverage.');
      const previous=input.coverage==='Shift'?getEffectivePricing(database.priceBook,input.branch,input.date,input.shiftId).prices:getEffectiveDailyPricing(database.priceBook,input.branch,input.date).prices;
      let prices;
      if(input.pricePatch){
        if(typeof input.pricePatch!=='object'||Array.isArray(input.pricePatch)||!Object.keys(input.pricePatch).length)reject('Invalid price update.');
        const allowed=session.role==='Manager'?SELLING_PRODUCTS:[...SELLING_PRODUCTS,'PremiumCost','RegularCost','DieselCost','fuelDeliveryCostMeta'];
        if(Object.keys(input.pricePatch).some(p=>!allowed.includes(p)))reject('Unknown price field.');
        prices={...previous,...input.pricePatch};
      }else{
        // Older open manager screens send all fuels, including stale values from
        // another confirmation. Keep confirmed mid-shift prices authoritative.
        prices={...previous,...input.prices,...(input.coverage==='Daily'?confirmedDailyPricePatch(database,input.branch,input.date):{})};
      }
      for(const p of SELLING_PRODUCTS)if(amount(prices[p])<=0)reject('Prices must be positive.');
      database.priceBook[input.branch][key]=prices;
      syncUnsubmittedPrices(database,input.branch,input.date,input.coverage==='Shift'?input.shiftId:'shift-1');
      audit('fuel-price-changed',session,{date:input.date,prices,pricePatch:input.pricePatch});save();return send({ok:true,prices});
    }
    if(route==='/api/demo/cv-status') {
      const report=database.reports[input.reportKey];if(!report)reject('Saved shift not found.',404);
      branchAccess(session,report.branch);return send({ok:true,report:exposeReport(report,session)});
    }
    if(route==='/api/demo/deposits') {
      requireRole(session,'Manager','Admin','Approver');const branch=input.branch||session.branch;branchAccess(session,branch);
      return send({ok:true,deposits:database.deposits.filter(d=>session.role!=='Manager'||d.branch===session.branch),coverage:coverage(branch,input.date||getCurrentShift().date),noDepositDays:database.noDepositDays,checkRequiredCount:Object.values(database.reports).filter(r=>r.branch===branch&&exposeReport(r,session).checkRequired).length});
    }
    if(route==='/api/demo/deposit-receipt') {
      requireRole(session,'Manager');branchAccess(session,input.branch);
      if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(input.data||''))reject('Upload a receipt photo.');
      const image=Buffer.from(input.data.split(',')[1],'base64');
      if(image.length>2*1024*1024||image[0]!==255||image[1]!==216)reject('Receipt photo is invalid or too large.');
      const path='/api/pilot/photo?id='+mutationId,file=database.mode+'/'+input.branch+'/'+mutationId+'.jpg';
      await uploadPhoto(file,image,{branch:input.branch,kind:'bank-receipt',uploadedAt:stamp()});
      database.photos[path]={branch:input.branch,file,kind:'bank-receipt',uploadedAt:stamp()};
      audit('deposit-receipt-uploaded',session,{receiptPath:path});save();return send({ok:true,receiptPath:path});
    }
    if(route==='/api/demo/deposit-submit') {
      requireRole(session,'Manager');branchAccess(session,input.branch);
      if(input.allocationVersion===1&&!String(input.reference||'').trim())input={...input,reference:'DEP-'+input.depositDate+'-'+mutationId.slice(0,8)};
      if(permittedDay(input.depositDate,database.noDepositDays)!==input.depositDate) reject('Choose a permitted deposit day.');
      if(!String(input.bank||'').trim() || !String(input.reference||'').trim()) reject('Bank and reference are required.');
      if(database.deposits.some(d=>d.branch===session.branch&&d.bank.toLowerCase()===input.bank.trim().toLowerCase()&&d.reference.toLowerCase()===input.reference.trim().toLowerCase()&&d.status!=='rejected')) reject('This bank reference has already been submitted.');
      const available=coverage(input.branch,input.depositDate);
      const keys=input.coveredReportKeys, carryIds=input.carryoverSourceIds;
      if(!Array.isArray(keys)||!Array.isArray(carryIds)||[...keys,...carryIds].some(k=>typeof k!=='string')||new Set(keys).size!==keys.length||new Set(carryIds).size!==carryIds.length) reject('Select each shift or remaining balance only once.');
      if(!keys.length&&!carryIds.length) reject('Select at least one shift or remaining balance.');
      if(keys.some(k=>!available.reports.some(r=>r.key===k))||carryIds.some(id=>!available.carryoverSourceIds.includes(id))) reject('A selected shift or balance is no longer available. Refresh and select again.',409);
      const reports=available.reports.filter(r=>keys.includes(r.key));
      const covered={reports,carryoverSourceIds:carryIds,coveredCash:money(reports.reduce((sum,r)=>sum+r.cash,0)),previousCarryover:money(database.deposits.filter(d=>carryIds.includes(d.id)).reduce((sum,d)=>sum+availableCarryover(d,database.deposits),0))};
      const explicit=input.allocationVersion===1;
      if(input.allocationVersion!==undefined&&!explicit)reject('Refresh the deposit form.');
      let allocationData={};
      if(explicit) {
        const checkAmount=value=>{
          if(typeof value==='boolean'||value==null||!/^\d+(?:\.\d{1,2})?$/.test(String(value)))reject('Enter allocation amounts with up to two decimal places.');
          const result=amount(value);if(result<=0)reject('Each selected shift needs an amount greater than zero.');return result;
        };
        if(!Array.isArray(input.reportAllocations)||!Array.isArray(input.carryoverAllocations)||input.reportAllocations.length!==keys.length||input.carryoverAllocations.length!==carryIds.length)reject('Enter an amount for every selected cash source.');
        if(new Set(input.reportAllocations.map(a=>a.reportKey)).size!==keys.length||new Set(input.carryoverAllocations.map(a=>a.depositId)).size!==carryIds.length)reject('Select each cash source only once.');
        const reportAllocations=input.reportAllocations.map(a=>{
          const source=reports.find(r=>r.key===a.reportKey);if(!source)reject('This shift is no longer available.',409);
          const value=checkAmount(a.amount);
          if(value>source.cash)reject('The shift allocation exceeds its available cash. Refresh and review.',409);
          if(amount(a.availableCash)!==source.cash)reject('Available shift cash changed. Refresh and review.',409);
          return {reportKey:source.key,amount:value};
        });
        const carryoverAllocations=input.carryoverAllocations.map(a=>{
          const source=database.deposits.find(d=>d.id===a.depositId&&carryIds.includes(d.id));if(!source)reject('This earlier balance is no longer available.',409);
          const cash=availableCarryover(source,database.deposits),value=checkAmount(a.amount);
          if(value>cash||amount(a.availableCash)!==cash)reject('Available earlier cash changed. Refresh and review.',409);
          return {depositId:source.id,amount:value};
        });
        covered.coveredCash=money(reportAllocations.reduce((n,a)=>n+a.amount,0));
        covered.previousCarryover=money(carryoverAllocations.reduce((n,a)=>n+a.amount,0));
        const receipt=database.photos[input.receiptPath];
        if(!receipt||receipt.kind!=='bank-receipt'||receipt.branch!==input.branch||(receipt.depositId&&database.deposits.some(d=>d.id===receipt.depositId&&d.status!=='rejected')))reject('Upload a receipt photo for this deposit.');
        allocationData={allocationVersion:1,reportAllocations,carryoverAllocations,receiptPath:input.receiptPath};
      }
      if((input.reviewedCoveredCash!==undefined&&amount(input.reviewedCoveredCash)!==covered.coveredCash)||(input.reviewedCarryover!==undefined&&amount(input.reviewedCarryover)!==covered.previousCarryover)) reject('The selected cash amount changed. Refresh and review it before submitting.',409);
      const adjustments=(input.adjustments||[]).map(a=>({type:a.type,amount:amount(a.amount),note:String(a.note||'').trim()}));
      if(adjustments.some(a=>!['TRANSPORTATION','BANK_FEE','OTHER_APPROVED_EXPENSE'].includes(a.type)||(a.type==='OTHER_APPROVED_EXPENSE'&&!a.note))) reject('Use a supported adjustment category and describe other approved expenses.');
      if(explicit&&(amount(input.amount)<=0||depositAmounts(covered.coveredCash,covered.previousCarryover,adjustments,amount(input.amount),false).unexplainedDifference!==0))reject('Shift amounts must match the deposit plus any fees. Adjust the amounts or remove a shift.');
      if(!explicit&&input.partial&&!String(input.note||'').trim()) reject('Explain the partial deposit.');
      const deposit={id:randomUUID(),branch:input.branch,depositDate:input.depositDate,bank:input.bank.trim(),reference:input.reference.trim(),amount:amount(input.amount),partial:explicit?false:!!input.partial,note:String(input.note||''),...allocationData,manager:session.role,status:'pending',coveredReportKeys:covered.reports.map(r=>r.key),carryoverSourceIds:covered.carryoverSourceIds,coveredCash:covered.coveredCash,previousCarryover:covered.previousCarryover,adjustments,...depositAmounts(covered.coveredCash,covered.previousCarryover,adjustments,amount(input.amount),explicit?false:!!input.partial)};
      database.deposits.push(deposit);
      if(explicit)database.photos[input.receiptPath]={...database.photos[input.receiptPath],depositId:deposit.id};
      for(const report of covered.reports) database.reports[report.key].depositCoverage={id:deposit.id,status:'pending',remaining:money(Math.max(0,Number(database.reports[report.key].actualCashCounted||0)-reservedReportCash(report.key,Number(database.reports[report.key].actualCashCounted||0),database.deposits)))};
      const anchor=covered.reports.at(-1)?.key || database.deposits.find(d=>d.id===covered.carryoverSourceIds[0])?.anchorKey;
      deposit.anchorKey=anchor;
      if(anchor) database.reports[anchor].deposits.push({...deposit,groupId:deposit.id,verified:false,coverageLabel:`${covered.reports.length} reports + carryover`,pilotAutomatic:true});
      audit('deposit-submitted',session,{depositId:deposit.id});save();return send({ok:true,deposit});
    }
    if(route==='/api/demo/deposit-verify') {
      requireRole(session,'Approver');const d=database.deposits.find(d=>d.id===input.id);
      if(!d || d.status!=='pending') reject('This deposit is already reviewed or unavailable.');
      if(!['confirm','reject'].includes(input.action)) reject('Unknown verification action.');
      if(input.action==='reject' && !['DEPOSIT NOT FOUND','WRONG AMOUNT','WRONG BANK','WRONG REFERENCE','PARTIAL AMOUNT RECEIVED','OTHER'].includes(input.reason)) reject('Choose a rejection reason.');
      d.status=input.action==='confirm'?'verified':'rejected';d.rejectionReason=input.action==='reject'?input.reason:'';
      for(const key of d.coveredReportKeys) {
        const remaining=money(Math.max(0,Number(database.reports[key].actualCashCounted||0)-reservedReportCash(key,Number(database.reports[key].actualCashCounted||0),database.deposits)));
        const latest=database.deposits.filter(other=>other.status!=='rejected'&&other.coveredReportKeys.includes(key)).at(-1);
        if(latest)database.reports[key].depositCoverage={id:latest.id,status:latest.status,remaining};
        else delete database.reports[key].depositCoverage;
      }
      if(d.anchorKey) database.reports[d.anchorKey].deposits=database.reports[d.anchorKey].deposits.map(row=>row.id===d.id?{...row,verified:d.status==='verified',removed:d.status==='rejected',status:d.status}:row);
      audit(`deposit-${d.status}`,session,{depositId:d.id,reason:d.rejectionReason});save();return send({ok:true});
    }
    if(route==='/api/demo/settings') {
      requireRole(session,'Admin');permittedDay(getCurrentShift().date,input.noDepositDays);database.noDepositDays=[...new Set(input.noDepositDays)];audit('no-deposit-days-changed',session);save();return send({ok:true});
    }
    if(route==='/api/demo/audit') {requireRole(session,'Admin');return send({ok:true,events:database.audit.slice(-100).reverse()});}
    if(route==='/api/admin/system-health') {requireRole(session,'Admin');return send({ok:true,loading:false,backups:{status:'Pilot transaction snapshots retained; restore drill required'},checks:[],issues:database.sourceAlerts||[]});}
    // Every unknown original production API fails closed; no fallback to the live system.
    reject('This action is unavailable in the station workflow.',403);

}
