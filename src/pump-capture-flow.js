import {completedPhotoOcrEvidence} from './ocr-evidence.js';
export const PHOTO_OCR_JOIN_MS=1200;

// Freeze once before sending and keep that exact body for same-ID retries.
// A restored legacy payload is already frozen; never add late OCR to it.
export async function finalizePumpPhotoInput(capture,snapshot,persist){
  if(capture.photoInputFinalized!==false)return capture.photoInput||snapshot;
  // Give clear photos a short chance to join the same save. Never wait for
  // the full OCR/setup deadline or hold a slow upload for more than 1.2s.
  if(!capture.result&&capture.recognition){
    let timer;
    try{await Promise.race([capture.recognition.catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,PHOTO_OCR_JOIN_MS);})]);}
    finally{clearTimeout(timer);}
  }
  const result=capture.result;
  const readyOcr=completedPhotoOcrEvidence('',result)?structuredClone({...result,attempt:{...result.attempt,captureToReadingMs:capture.captureToReadingMs}}):null;
  capture.photoInput={...snapshot,...(readyOcr?{readyOcr}:{})};
  capture.photoInputFinalized=true;
  await persist(capture);
  return capture.photoInput;
}

export function captureDuration(capture,now=Date.now()){
  return Number.isFinite(capture.startedAtMs)?Math.max(0,Math.round(now-capture.startedAtMs)):undefined;
}
