import {MABOLO_TOTALIZER_FORMAT_ID} from './ocr-evidence.js';

// The owner confirmed this hardware format on 2026-11-10. It supplies only
// decimal placement and complete cell count, never an expected counter value.
const mabolo=Object.freeze({id:MABOLO_TOTALIZER_FORMAT_ID,integerDigits:5,decimalPlaces:2});
export function totalizerFormatForStation(station){
  return String(station||'').trim().toLowerCase()==='mabolo'?mabolo:null;
}
export function confirmedTotalizerFormat(format){
  return format?.id===mabolo.id&&format.integerDigits===5&&format.decimalPlaces===2?mabolo:null;
}
export function formatTotalizerSuggestion(value,format){
  if(value===null||value===undefined||value==='')return '';
  const number=Number(value);
  return confirmedTotalizerFormat(format)&&Number.isFinite(number)&&Math.round(number*100)/100===number?
    number.toFixed(format.decimalPlaces):String(value);
}
