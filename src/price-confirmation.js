import {reportStartingPrice} from './mid-shift-price-change.js';
import {midShiftChangeOrder} from './mid-shift-sales-breakdown.js';

const cents=value=>Math.round(Number(value)*100);
export const LARGE_PRICE_CHANGE_PERCENT=20;
export function needsPriceReentry(previous,next) {
  const before=cents(previous),after=cents(next);
  return after>0&&before!==after&&(!Number.isFinite(before)||before<=0||Math.abs(after-before)*100>=before*LARGE_PRICE_CHANGE_PERCENT);
}
export function priceReviewKey(context) {
  return JSON.stringify([context.branch,context.date,context.coverage,context.coverage==='Shift'?context.shiftId:'daily',context.product,cents(context.previousPrice),cents(context.newPrice),context.changeId||'',context.effectiveTime||'']);
}
export function priceReviewError(context,review) {
  if(cents(context.previousPrice)===cents(context.newPrice))return '';
  if(review&&review.reviewKey!==priceReviewKey(context))return 'The price or its effective date / shift changed. Refresh prices and review the change again.';
  if(!needsPriceReentry(context.previousPrice,context.newPrice))return '';
  if(!review||review.reviewKey!==priceReviewKey(context)||!/^\d+(?:\.\d{1,2})?$/.test(String(review.typedPrice||''))||cents(review.typedPrice)!==cents(context.newPrice))return 'Large price changes require re-entering the exact new price in pesos per litre before saving.';
  return '';
}
export function midShiftPriceReviewContext(report,change) {
  const order=midShiftChangeOrder(change,report.shiftId);
  const earlier=(report.midShiftPriceChanges||[]).filter(row=>row.id!==change.id&&row.product===change.product&&row.confirmedAt&&midShiftChangeOrder(row,report.shiftId)<order).sort((a,b)=>midShiftChangeOrder(a,report.shiftId)-midShiftChangeOrder(b,report.shiftId));
  return {branch:report.branch,date:report.date,coverage:'Shift',shiftId:report.shiftId,product:change.product,previousPrice:earlier.at(-1)?.newPrice??reportStartingPrice(report,change.product),newPrice:change.newPrice,changeId:change.id,effectiveTime:change.effectiveTime};
}
export function requestPriceReview(context,{confirm,prompt}) {
  const php=value=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(value||0));
  const shift=context.coverage==='Daily'?'All shifts · Daily price':`Shift ${context.shiftId.slice(-1)}`;
  const details=`Station: ${context.branch}\nProduct: ${context.product}\nEffective date: ${context.date}\nCoverage: ${shift}${context.effectiveTime?' · '+context.effectiveTime:''}\n${php(context.previousPrice)} → ${php(context.newPrice)} per litre`;
  if(!confirm(`${needsPriceReentry(context.previousPrice,context.newPrice)?'PLEASE CHECK THIS LARGE PRICE CHANGE\n':''}${details}\nSave this price change?`))return null;
  const review={reviewKey:priceReviewKey(context)};
  if(needsPriceReentry(context.previousPrice,context.newPrice)){
    const typed=prompt(`${details}\nType the NEW price again, in pesos per litre. Check the decimal point.`,'');
    if(typed===null)return null;
    review.typedPrice=String(typed).trim();
    const error=priceReviewError(context,review);if(error)throw Error(error);
  }
  return review;
}
