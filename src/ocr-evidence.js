export const TOTALIZER_VERSION='lcd-frame-check-2';

// An OCR attempt belongs to one photo, independently of the cashier's number.
// A confirmation/edit from an older client must not erase that evidence.
export function mergeOcrEvidence(previous,incoming){
  const samePhoto=previous?.photo_path===incoming.photo_path;
  const reading=incoming.ocr_detected_reading??(samePhoto?previous?.ocr_detected_reading:null)??null;
  const attempt=incoming.ocr_result||(samePhoto?previous?.ocr_result:null);
  let result;
  if(attempt&&['pending','detected','no-reading','error'].includes(attempt.status)){
    const status=reading!==null?'detected':attempt.status==='detected'?'no-reading':attempt.status;
    result={status,version:String(attempt.version||'unknown').slice(0,80)};
    if(attempt.completedAt&&!Number.isNaN(Date.parse(attempt.completedAt)))result.completedAt=new Date(attempt.completedAt).toISOString();
    if(status==='error')result.reason='recognition-failed';
  }
  return {ocr_detected_reading:reading,...(result?{ocr_result:result}: {})};
}
