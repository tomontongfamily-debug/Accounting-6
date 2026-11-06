export const TOTALIZER_VERSION='lcd-format-evidence-10';
export const OCR_ATTEMPT_TIMEOUT_MS=30000;

export function pendingOcrAttempt(now=Date.now()){
  const startedAt=new Date(now).toISOString();
  return {status:'pending',version:TOTALIZER_VERSION,startedAt,deadlineAt:new Date(Date.parse(startedAt)+OCR_ATTEMPT_TIMEOUT_MS).toISOString()};
}

// An OCR attempt belongs to one photo, independently of the cashier's number.
// A confirmation/edit from an older client must not erase that evidence.
export function mergeOcrEvidence(previous,incoming,{now=Date.now()}={}){
  const samePhoto=previous?.photo_path===incoming.photo_path;
  const reading=incoming.ocr_detected_reading??(samePhoto?previous?.ocr_detected_reading:null)??null;
  const previousAttempt=samePhoto?previous?.ocr_result:null;
  // A manual confirmation or a delayed browser save can carry the upload's
  // original pending marker. It must not erase a completed result for this photo.
  let attempt=incoming.ocr_result||previousAttempt;
  if(attempt?.status==='pending'&&previousAttempt&&['detected','no-reading','error'].includes(previousAttempt.status))attempt=previousAttempt;
  // Confirming a number is a separate human action. If OCR never completed,
  // retain that fact explicitly rather than showing an active attempt forever.
  if(incoming.readingConfirmed&&reading===null&&attempt?.status==='pending')attempt={...attempt,status:'error',reason:'recognition-interrupted',completedAt:new Date(now).toISOString()};
  let result;
  if(attempt&&['pending','detected','no-reading','error'].includes(attempt.status)){
    const status=reading!==null?'detected':attempt.status==='detected'?'no-reading':attempt.status;
    result={status,version:String(attempt.version||'unknown').slice(0,80)};
    for(const key of ['startedAt','deadlineAt','completedAt']){
      const value=key==='completedAt'?attempt[key]:previousAttempt?.[key]||attempt[key];
      if(value&&!Number.isNaN(Date.parse(value)))result[key]=new Date(value).toISOString();
    }
    if(Number.isFinite(attempt.durationMs)&&attempt.durationMs>=0&&attempt.durationMs<=3600000)result.durationMs=Math.round(attempt.durationMs);
    if(status==='error')result.reason=['recognition-timeout','initialization-timeout','worker-failed','unsupported-browser','recognition-failed','recognition-interrupted'].includes(attempt.reason)?attempt.reason:'recognition-failed';
    for(const key of ['queueMs','photoSaveMs','readingSaveMs'])if(Number.isFinite(attempt[key])&&attempt[key]>=0&&attempt[key]<=3600000)result[key]=Math.round(attempt[key]);
  }
  return {ocr_detected_reading:reading,...(result?{ocr_result:result}: {})};
}
