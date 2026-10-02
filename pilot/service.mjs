import { randomUUID } from 'node:crypto';
import { createReport, compute, carryForwardOpenings, getEffectivePricing, reportKey } from '../src/accounting-engine.js';
import { amount, automaticCashVouchers, automaticTransactions, cashNeedsRecount, datePlus, denominationTotal, depositAmounts, depositCoverage, money, permittedDay, readingComplete, readingWarning, reportIssues } from './domain.mjs';
import { midShiftPumpKey, midShiftReadingValue } from '../src/mid-shift-price-change.js';

import { accountingTiming, dateOffset } from './integrations.mjs';
const stamp=()=>new Date().toISOString();
const keyOf=r=>reportKey(r.branch,r.date,r.shiftId);
const reject=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
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
 branchAccess(session,'Liloan');
 if(!['Cashier','Manager','Admin','Approver'].includes(session.role)) reject('Invalid role.',403);
function requireRole(session,...roles) { if(!roles.includes(session.role)) reject('This action is not available for your role.',403); }
function branchAccess(session,branch) {
  if(branch!=='Liloan') reject('Unknown station.');
  if(['Cashier','Manager'].includes(session.role)&&branch!==session.branch) reject('This report belongs to another station.',403);
}
function authoritative(r) {
  if(r.date<database.startDate) return r;
  const pay=automaticTransactions(database.pay,r), po=automaticTransactions(database.po,r);
  const pricing=getEffectivePricing(database.priceBook,r.branch,r.date,r.shiftId);
  const active=database.deposits.filter(d=>d.status!=='rejected');
  const consumed=new Set(active.flatMap(d=>d.carryoverSourceIds));
  const reserved=active.some(d=>d.coveredReportKeys.includes(keyOf(r)));
  const remainder=active.filter(d=>d.anchorKey===keyOf(r)&&!consumed.has(d.id)).reduce((sum,d)=>sum+d.carryoverRemaining+Math.max(0,d.unexplainedDifference),0);
  const pilotCashAwaitingDeposit=r.confirmed?money((reserved?0:Number(r.actualCashCounted||0))+remainder):undefined;
  if(r.confirmed) return {...r,pilotCashAwaitingDeposit};
  const purchaseRows=r.confirmed?r.purchaseRows:[...(r.purchaseRows||[]).filter(row=>row.source!=='FuelTech CV'),...automaticCashVouchers(database.cvCashEvents||[],r)];
  const next={...r,purchaseRows,cvImport:{mode:database.mode,source:'FuelTech CV'},pilotCashAwaitingDeposit,prices:{...r.prices,...pricing.prices},poRows:po.transactions.map(t=>({...t,source:'FuelTech Pay'})),onlinePay:{total:pay.total,count:pay.count,source:'FuelTech Pay'},deductions:{...r.deductions,gcash:pay.total,card:0,paymaya:0}};
  if(next.cashReviewState && next.reviewedExpectedCash!==compute(next).expectedCash) {next.cashReviewState='';next.recountRequired=false;}
  return next;
}
function candidate(input,session,readingId) {
  if(!input || !['shift-1','shift-2','shift-3'].includes(input.shiftId)) reject('Invalid report.');
  branchAccess(session,input.branch); datePlus(input.date,0);
  const old=database.reports[keyOf(input)];
  if(!old) reject('Refresh the shift dashboard first.');
  if(old.confirmed) reject('This report is locked. Use the existing Admin correction process.',423);
  if(old.date<database.startDate) reject('Historical reports are read-only.',423);
  const preceding=old.shiftId==='shift-1'?reportKey(old.branch,dateOffset(old.date,-1),'shift-3'):reportKey(old.branch,old.date,old.shiftId==='shift-2'?'shift-1':'shift-2');
  if(!database.reports[preceding]?.confirmed) reject('Submit the preceding shift before recording this shift.');
  if(!readingId && Number(input.pilotRevision||0)!==Number(old.pilotRevision||0)) reject('This shift changed on another device. Refresh before saving.',409);
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
    return {...base,closing:row.closing,closingEntered:row.closingEntered,closingEntrySource:row.closingEntrySource,photo_path:row.photo_path,ocr_detected_reading:row.ocr_detected_reading??null,ocr_was_edited:row.ocr_detected_reading!=null && Number(row.closing)!==Number(row.ocr_detected_reading),readingConfirmed:row.readingConfirmed,calculated_liters:row.closing===''?null:money(Number(row.closing)-Number(base.opening))};
  });
  const allowed=Object.fromEntries(['cashierName','tankRows','deliveries','oilSales','actualCashCounted','cashDenominations','notes','coke','pointsIssued','pointsWithdrawn','clientSave'].filter(k=>Object.hasOwn(input,k)).map(k=>[k,input[k]]));
  const r=authoritative({...old,...allowed,purchaseRows:old.purchaseRows,pumpRows:rows,confirmed:false,confirmedAt:'',deposits:old.deposits,prices:old.prices,midShiftPriceChanges:old.midShiftPriceChanges,baselineConfirmed:old.baselineConfirmed,baselineMissing:old.baselineMissing,checkDetails:old.checkDetails,cashCountConfirmed:old.cashCountConfirmed,cashReviewState:old.cashReviewState,recountRequired:old.recountRequired,integrationIssues:old.integrationIssues});
  if(old.cashCountConfirmed) {r.actualCashCounted=old.actualCashCounted;r.cashDenominations=old.cashDenominations;}
  else if(r.cashDenominations&&Object.values(r.cashDenominations).some(v=>v!==''&&v!=null)) r.actualCashCounted=denominationTotal(r.cashDenominations);
  else if(r.cashDenominations) r.actualCashCounted='';
  r.initialCashDenominations=old.initialCashDenominations;
  r.depositCoverage=old.depositCoverage;
  r.midShiftBasePrices=old.midShiftBasePrices;
  for(const key of ['cashRedemption','fuelRedemption']) r.deductions[key]=input.deductions?.[key]??old.deductions?.[key]??0;
  amount(r.oilSales||0);
  const deliveryKeys=new Set();
  for(const delivery of r.deliveries||[]) {
    if(!['Premium','Regular','Diesel'].includes(delivery.product)||amount(delivery.liters)<=0||!/^([01]\d|2[0-3]):[0-5]\d$/.test(delivery.time)||!String(delivery.reference||'').trim()) reject('Complete product, liters, time and reference for each tank delivery.');
    const deliveryKey=`${delivery.product}|${delivery.reference.trim().toLowerCase()}`;
    if(deliveryKeys.has(deliveryKey)) reject('Duplicate tank delivery reference.');
    deliveryKeys.add(deliveryKey);
    if(Object.values(database.reports).some(other=>other.branch===r.branch&&keyOf(other)!==keyOf(r)&&(other.deliveries||[]).some(d=>`${d.product}|${String(d.reference).trim().toLowerCase()}`===deliveryKey))) reject('This delivery is already recorded in another shift.');
  }
  r.tankRows=template.tankRows.map(base=>{
    const row=(r.tankRows||[]).find(t=>t.id===base.id)||base;
    for(const value of [row.actualDip,row.pullOut,row.calibration]) if(value!==''&&value!=null) amount(value);
    return {...row,opening:base.opening,product:base.product,tank:base.tank,delivery:(r.deliveries||[]).filter(d=>d.product===base.product).reduce((sum,d)=>sum+Number(d.liters),0)};
  });
  for(const row of r.purchaseRows||[]) {
    if(!['OPEX','Personal','Personnel','Construction'].includes(row.category) || !String(row.item||'').trim()) continue; // drafts can be incomplete
    amount(row.amount);
  }
  for(const value of Object.values(r.deductions)) { if(value!=='' && value!=null) amount(value); }
  return r;
}
function storeReport(r,session,action) {
  if(r.date<database.startDate) reject('Historical reports are read-only in the pilot.',423);
  r.pilot=true; r.pilotRevision=Number(database.reports[keyOf(r)]?.pilotRevision||0)+1;
  r.serverMeta={...r.serverMeta,reportId:r.serverMeta?.reportId||(r.confirmed?randomUUID():''),savedAt:stamp()};
  database.reports[keyOf(r)]=r;
  audit(action,session,{reportKey:keyOf(r)}); save();
  return {ok:true,report:r,reportId:r.serverMeta.reportId};
}
function coverage(branch,date) {
  return depositCoverage(Object.values(database.reports).filter(r=>r.date>=database.startDate).map(r=>({key:keyOf(r),branch:r.branch,date:r.date,shiftId:r.shiftId,cash:Number(r.actualCashCounted||0),confirmed:!!r.confirmed})),database.deposits,branch,date,database.noDepositDays);
}
function exposeReport(report,session) {
  const r=structuredClone(authoritative(report));
  const sourceIssues=(database.sourceAlerts||[]).filter(a=>a.reportKey===keyOf(r));
  if(sourceIssues.length) r.checkDetails=[...(r.checkDetails||[]),...sourceIssues];
  if(r.date>=database.startDate) r.pilot=true;
  if(r.confirmed) {
    r.checkDetails=(r.checkDetails||[]).filter(i=>!['BANK_DEPOSIT','BANK_VERIFIER'].includes(i.category));
    for(const d of database.deposits.filter(d=>d.anchorKey===keyOf(r))) {
      if(d.status!=='rejected'&&d.unexplainedDifference!==0) r.checkDetails.push({category:'BANK_DEPOSIT',detail:`Deposit ${d.reference}: unexplained difference ${d.unexplainedDifference.toFixed(2)}.`});
      if(d.status==='rejected') r.checkDetails.push({category:'BANK_VERIFIER',detail:`Deposit ${d.reference} rejected: ${d.rejectionReason}.`});
    }
    r.checkCategories=[...new Set(r.checkDetails.map(i=>i.category))];r.checkRequired=!!r.checkDetails.length;
  }
  if(session.role==='Cashier') {
    delete r.checkDetails; delete r.cashVarianceReason;
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
    if(route==='/api/realtime/config') return send({enabled:false});
    if(route==='/api/reports/lease') return send({ok:true,editors:[],activeEditors:[],acquired:true});
    if(route==='/api/store/load' || route==='/api/prices/load') {
      const allowed=branch=>['Admin','Approver'].includes(session.role)||branch===session.branch;
      const priceRows=Object.entries(database.priceBook).filter(([b])=>allowed(b)).flatMap(([branch,book])=>Object.entries(book).map(([date,prices])=>({branch,effective_date:date.split('__')[0],coverage:date.includes('__')?'Shift':'Daily',shift_id:date.split('__')[1]||'daily',prices,updated_at:stamp()})));
      const reportRows=Object.values(database.reports).filter(r=>allowed(r.branch)).map(r=>({report_key:keyOf(r),branch:r.branch,report_date:r.date,shift_id:r.shiftId,data:exposeReport(r,session),updated_at:stamp()}));
      return send({ok:true,priceRows,reportRows});
    }
    if(route==='/api/reports/save') {
      requireRole(session,'Cashier','Manager','Admin');
      let old=database.reports[keyOf(input.report||{})];
      if(input.report?.date<database.startDate) reject('Historical reports are read-only.',423);
      if(old && Number(input.report?.pilotRevision||0)!==Number(old.pilotRevision||0)) reject('This shift changed on another device. Refresh before saving.',409);
      if(input.operation==='request-correction') {
        branchAccess(session,old?.branch); const r={...old,correctionRequest:{...input.report.correctionRequest,status:'pending'}};
        return send(storeReport(r,session,'correction-requested'));
      }
      if(session.role==='Admin') {
        if(!old) reject('Report not found.');
        if(input.report.correctionRequest?.status==='approved') {
          if(database.deposits.some(d=>d.status!=='rejected'&&d.coveredReportKeys.includes(keyOf(old)))) reject('Resolve the existing deposit coverage before reopening this report.',409);
          return send(storeReport({...old,confirmed:false,correctionRequest:input.report.correctionRequest,cashCountConfirmed:false,cashReviewState:'',recountRequired:false},session,'correction-approved'));
        }
        if(input.report.correctionRequest?.status==='rejected') return send(storeReport({...old,correctionRequest:input.report.correctionRequest},session,'correction-rejected'));
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
        const changes=incoming.map(c=>{
          if(!['Premium','Regular','Diesel'].includes(c.product)) reject('Unknown fuel product.');
          const previous=old.midShiftPriceChanges?.find(p=>p.id===c.id);
          const sameContext=previous?.product===c.product&&previous?.effectiveTime===c.effectiveTime;
          const next={id:c.id,product:c.product,effectiveTime:c.effectiveTime,newPrice:c.newPrice,photoRequired:previous?!!previous.photoRequired:true,readings:sameContext?(previous.readings||{}):{},readingPhotos:sameContext?(previous.readingPhotos||{}):{},confirmedAt:''};
          if(sameContext&&previous.newPrice===c.newPrice) next.confirmedAt=previous.confirmedAt||'';
          if(c.confirmedAt) {if(next.photoRequired)validatePricePhotos({...old,midShiftPriceChanges:[next]},next);next.confirmedAt=stamp();}
          return next;
        });
        const changed=JSON.stringify(changes)!==JSON.stringify(old.midShiftPriceChanges||[]);
        return send(storeReport({...old,midShiftPriceChanges:changes,midShiftBasePrices:old.midShiftBasePrices||old.prices,...(changed?{cashReviewState:'',recountRequired:false}:{})},session,'mid-shift-price-change'));
      }
      const r=candidate(input.report,session);
      if(input.operation==='submit') {
        if(r.reviewedExpectedCash!==compute(r).expectedCash) reject('Cash or source totals changed. Check cash reconciliation again.');
        if((database.sourceAlerts||[]).some(a=>a.reportKey===keyOf(r))) reject('A source voucher changed or was cancelled. Admin must review before submission.');
        if(!database.sourcesVerifiedAt || Date.now()-Date.parse(database.sourcesVerifiedAt)>120000) reject('Verify online payment, PO and CV records before submission.');
        if(!r.cashCountConfirmed || !r.cashReviewState || (r.recountRequired && r.cashReviewState!=='final')) reject('Confirm your cash and complete the recount first.');
        if(r.pumpRows.some(row=>!readingComplete(row))) reject('Complete all pump/nozzle photos and confirmed readings before submitting.');
        if(!String(r.cashierName||'').trim()) reject('Enter the cashier name.');
        for(const row of r.purchaseRows||[]) if(!['OPEX','Personal','Personnel','Construction'].includes(row.category)||!String(row.item||'').trim()||amount(row.amount)<=0) reject('Complete the category, note and amount for each deduction.');
        if(r.pumpRows.some(row=>Number(r.prices[row.product])<=0)) reject('Manager fuel prices are missing.');
        for(const change of r.midShiftPriceChanges||[]) {
          if(change.photoRequired){validatePricePhotos(r,change);if(!change.confirmedAt)reject('Manager must confirm the price change before submission.');}
          if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(change.effectiveTime)||Number(change.newPrice)<=0) reject('Complete the manager mid-shift price change before submission.');
          if(r.pumpRows.filter(row=>row.product===change.product).some(row=>midShiftReadingValue(change,row)===''||Number(midShiftReadingValue(change,row))<Number(row.opening)||Number(midShiftReadingValue(change,row))>Number(row.closing))) reject('Review all readings for the mid-shift price change.');
        }
        r.confirmed=true;r.confirmedAt=stamp();r.checkDetails=reportIssues(r,compute(r).cashVariance);r.checkCategories=[...new Set(r.checkDetails.map(i=>i.category))];r.checkRequired=!!r.checkDetails.length;
      }
      const previousRows=old?.pumpRows||[];
      for(const row of r.pumpRows) if(row.readingConfirmed && !previousRows.find(p=>p.id===row.id&&p.readingConfirmed&&p.closing===row.closing&&p.photo_path===row.photo_path)) audit(row.ocr_was_edited?'ocr-reading-edited':'pump-reading-confirmed',session,{reportKey:keyOf(r),rowId:row.id,ocr:row.ocr_detected_reading,final:row.closing});
      if(JSON.stringify(old?.deliveries||[])!==JSON.stringify(r.deliveries||[])) audit('tank-delivery-changed',session,{reportKey:keyOf(r),before:old?.deliveries||[],after:r.deliveries||[]});
      if(JSON.stringify(old?.purchaseRows||[])!==JSON.stringify(r.purchaseRows||[])) audit('manual-deduction-changed',session,{reportKey:keyOf(r),before:old?.purchaseRows||[],after:r.purchaseRows||[]});
      return send(storeReport(r,session,input.operation==='submit'?'report-submitted':'draft-saved'));
    }
    if(route==='/api/demo/cash-confirm' || route==='/api/demo/cash-check' || route==='/api/demo/cash-recount') {
      requireRole(session,'Cashier');const r=candidate(input.report,session);
      if(route.endsWith('cash-confirm')) { if(r.cashCountConfirmed) reject('Cash count is already confirmed.');r.actualCashCounted=denominationTotal(input.denominations);r.cashDenominations=input.denominations;r.initialCashDenominations=input.denominations;r.cashCountConfirmed=true; }
      if(route.endsWith('cash-check')) {
        if(!r.cashCountConfirmed || r.pumpRows.some(row=>!readingComplete(row))) reject('Confirm cash and complete all readings first.');
        if(r.cashReviewState && r.reviewedExpectedCash===compute(r).expectedCash) return send({ok:true,needsRecount:!!r.recountRequired,report:exposeReport(r,session)});
        r.reviewedExpectedCash=compute(r).expectedCash;
        r.recountRequired=cashNeedsRecount(Number(r.actualCashCounted),compute(r).expectedCash);r.cashReviewState=r.recountRequired?'recount':'checked';
      }
      if(route.endsWith('cash-recount')) { if(r.cashReviewState!=='recount') reject('Recount is not available.');r.actualCashCounted=denominationTotal(input.denominations);r.cashDenominations=input.denominations;r.cashReviewState='final'; }
      storeReport(r,session,route.split('/').at(-1));return send({ok:true,needsRecount:!!r.recountRequired,report:exposeReport(r,session)});
    }
    if(route==='/api/demo/pump-report' || route==='/api/demo/pump-reading') {
      requireRole(session,'Cashier');
      const old=database.reports[input.reportKey];branchAccess(session,old?.branch);
      if(route.endsWith('pump-report')) return send({ok:true,report:exposeReport(carryForwardOpenings(old,database.reports),session)});
      if(old.confirmed) reject('Submitted report is locked.',423);
      if(old.baselineReport||old.baselineMissing) reject('Complete starting-opening setup on desktop first.');
      const base=old.pumpRows.find(row=>row.id===input.row?.id);
      if(!base) reject('Unknown nozzle.');
      if(Number(input.revision)!==Number(base.readingRevision||0)) reject('This nozzle changed on another device. Refresh the readings before trying again.',409);
      const r=candidate({...old,pumpRows:old.pumpRows.map(row=>row.id===base.id?{...row,...input.row}:row)},session,base.id);
      const row=r.pumpRows.find(row=>row.id===base.id);
      if(row.readingConfirmed && (!readingComplete(row)||readingWarning(row).blocked)) reject('A valid photo and closing reading are required.');
      row.readingRevision=Number(base.readingRevision||0)+1;
      // A changed reading requires a fresh final cash check.
      r.cashReviewState='';r.recountRequired=false;
      audit(row.ocr_was_edited?'ocr-reading-edited':'pump-reading-saved',session,{reportKey:keyOf(r),rowId:row.id,ocr:row.ocr_detected_reading,final:row.closing});
      storeReport(r,session,'pump-reading-saved');return send({ok:true,report:exposeReport(r,session)});
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
      const evidence={photo_path:input.row.photo_path,readingConfirmed:!!input.row.readingConfirmed,readingRevision:Number(previous?.readingRevision||0)+1,ocr_detected_reading:input.row.ocr_detected_reading??null,ocr_was_edited:input.row.ocr_detected_reading!=null&&value!==Number(input.row.ocr_detected_reading)};
      change.readingPhotos={...change.readingPhotos,[key]:evidence};change.readings={...change.readings,[key]:value};change.confirmedAt='';change.photoRequired=true;
      r.cashReviewState='';r.recountRequired=false;
      audit('price-change-reading-saved',session,{reportKey:keyOf(r),changeId:change.id,rowId:row.id,final:value,ocr:evidence.ocr_detected_reading});
      return send(storeReport(r,session,'price-change-photo-saved'));
    }
    if(route==='/api/demo/photo') {
      requireRole(session,input.changeId?'Manager':'Cashier');const r=database.reports[input.reportKey];branchAccess(session,r?.branch);
      if(r.confirmed) reject('Submitted report is locked.',423);
      const photoRow=r.pumpRows.find(row=>input.changeId?midShiftPumpKey(row)===input.pumpKey:row.id===input.rowId);
      if(!photoRow) reject('Unknown nozzle.');
      const change=input.changeId?r.midShiftPriceChanges?.find(c=>c.id===input.changeId):null;
      if(input.changeId&&(!change||!change.effectiveTime||photoRow.product!==change.product)) reject('Save the product and price-change time before taking photos.');
      if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(input.data||'')) reject('Use a JPEG photo.');
      const image=Buffer.from(input.data.split(',')[1],'base64');
      if(image.length>2*1024*1024 || image[0]!==255 || image[1]!==216) reject('Invalid or oversized photo.');
      const id=mutationId, photoPath='/api/pilot/photo?id='+id;
      const objectPath=database.mode+'/Liloan/'+id+'.jpg';
      await uploadPhoto(objectPath,image);
      database.photos[photoPath]={reportKey:input.reportKey,rowId:photoRow.id,branch:r.branch,file:objectPath,...(change?{changeId:change.id,product:change.product,effectiveTime:change.effectiveTime}: {})};
      audit('pump-photo-uploaded',session,{reportKey:input.reportKey,rowId:photoRow.id});save();return send({ok:true,photo_path:photoPath});
    }
    if(route==='/api/demo/issue') {
      requireRole(session,'Cashier');const r=candidate(input.report,session);
      if(!['ONLINE_PAY','PO','REDEMPTION','OTHER'].includes(input.category)||!String(input.detail||'').trim()) reject('Describe the issue.');
      r.integrationIssues=[...(r.integrationIssues||[]),{category:input.category,detail:String(input.detail).slice(0,500)}];return send(storeReport(r,session,'integration-issue-reported'));
    }
    if(route==='/api/prices/save') {
      if(input.date<database.startDate) reject('Historical prices are read-only.',423);
      requireRole(session,'Manager','Admin');branchAccess(session,input.branch);datePlus(input.date,0);
      for(const p of ['Premium','Regular','Diesel']) if(amount(input.prices[p])<=0) reject('Prices must be positive.');
      const key=input.coverage==='Shift'?`${input.date}__${input.shiftId}`:input.date;
      database.priceBook[input.branch][key]=input.prices;audit('fuel-price-changed',session,{date:input.date,prices:input.prices});save();return send({ok:true});
    }
    if(route==='/api/demo/deposits') {
      requireRole(session,'Manager','Admin','Approver');const branch=input.branch||session.branch;branchAccess(session,branch);
      return send({ok:true,deposits:database.deposits.filter(d=>session.role!=='Manager'||d.branch===session.branch),coverage:coverage(branch,input.date||getCurrentShift().date),noDepositDays:database.noDepositDays,checkRequiredCount:Object.values(database.reports).filter(r=>r.branch===branch&&exposeReport(r,session).checkRequired).length});
    }
    if(route==='/api/demo/deposit-submit') {
      requireRole(session,'Manager');branchAccess(session,input.branch);
      if(permittedDay(input.depositDate,database.noDepositDays)!==input.depositDate) reject('Choose a permitted deposit day.');
      if(!String(input.bank||'').trim() || !String(input.reference||'').trim()) reject('Bank and reference are required.');
      if(database.deposits.some(d=>d.branch===session.branch&&d.bank.toLowerCase()===input.bank.trim().toLowerCase()&&d.reference.toLowerCase()===input.reference.trim().toLowerCase()&&d.status!=='rejected')) reject('This bank reference has already been submitted.');
      const available=coverage(input.branch,input.depositDate);
      const keys=input.coveredReportKeys, carryIds=input.carryoverSourceIds;
      if(!Array.isArray(keys)||!Array.isArray(carryIds)||[...keys,...carryIds].some(k=>typeof k!=='string')||new Set(keys).size!==keys.length||new Set(carryIds).size!==carryIds.length) reject('Select each shift or remaining balance only once.');
      if(!keys.length&&!carryIds.length) reject('Select at least one shift or remaining balance.');
      if(keys.some(k=>!available.reports.some(r=>r.key===k))||carryIds.some(id=>!available.carryoverSourceIds.includes(id))) reject('A selected shift or balance is no longer available. Refresh and select again.',409);
      const reports=available.reports.filter(r=>keys.includes(r.key));
      const covered={reports,carryoverSourceIds:carryIds,coveredCash:money(reports.reduce((sum,r)=>sum+r.cash,0)),previousCarryover:money(database.deposits.filter(d=>carryIds.includes(d.id)).reduce((sum,d)=>sum+d.carryoverRemaining,0))};
      if((input.reviewedCoveredCash!==undefined&&amount(input.reviewedCoveredCash)!==covered.coveredCash)||(input.reviewedCarryover!==undefined&&amount(input.reviewedCarryover)!==covered.previousCarryover)) reject('The selected cash amount changed. Refresh and review it before submitting.',409);
      const adjustments=(input.adjustments||[]).map(a=>({type:a.type,amount:amount(a.amount),note:String(a.note||'').trim()}));
      if(adjustments.some(a=>!['TRANSPORTATION','BANK_FEE','OTHER_APPROVED_EXPENSE'].includes(a.type)||(a.type==='OTHER_APPROVED_EXPENSE'&&!a.note))) reject('Use a supported adjustment category and describe other approved expenses.');
      if(input.partial&&!String(input.note||'').trim()) reject('Explain the partial deposit.');
      const deposit={id:randomUUID(),branch:input.branch,depositDate:input.depositDate,bank:input.bank.trim(),reference:input.reference.trim(),amount:amount(input.amount),partial:!!input.partial,note:String(input.note||''),manager:session.role,status:'pending',coveredReportKeys:covered.reports.map(r=>r.key),carryoverSourceIds:covered.carryoverSourceIds,coveredCash:covered.coveredCash,previousCarryover:covered.previousCarryover,adjustments,...depositAmounts(covered.coveredCash,covered.previousCarryover,adjustments,amount(input.amount),!!input.partial)};
      database.deposits.push(deposit);
      for(const report of covered.reports) database.reports[report.key].depositCoverage={id:deposit.id,status:'pending'};
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
        if(d.status==='rejected') delete database.reports[key].depositCoverage;
        else database.reports[key].depositCoverage={id:d.id,status:d.status};
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
    reject('This action is unavailable in the Liloan pilot.',403);

}
