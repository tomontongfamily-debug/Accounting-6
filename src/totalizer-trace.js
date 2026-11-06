// Optional diagnostics contain numeric reader evidence only. They never affect
// recognition, and a failed observer must not interrupt a deadline or result.
export function createTotalizerTracer(observer,now=()=>performance.now()){
 const started=now();let count=0,closed=false;
 return(stage,details={},terminal=false)=>{
  if(typeof observer!=='function'||closed||count>=(terminal?120:119))return;
  count++;if(terminal)closed=true;
  try{observer({...details,stage,elapsedMs:Math.max(0,Math.round(now()-started))});}catch{ /* Diagnostics cannot change the result. */ }
 };
}
export function traceSymbols(symbols){
 return symbols.slice(0,12).map(symbol=>({text:String(symbol.text||'').replace(/[^0-9.?]/g,'').slice(0,2),
  confidence:Number.isFinite(symbol.confidence)?Math.round(symbol.confidence*10)/10:null,
  ambiguous:!!symbol.lcdAmbiguous,verified:!!symbol.lcdVerified,
  box:symbol.bbox?['x0','y0','x1','y1'].map(key=>Number.isFinite(symbol.bbox[key])?Math.round(symbol.bbox[key]*10)/10:null):null}));
}
export function traceCandidates(candidates){
 return candidates.slice(0,16).map(candidate=>Object.fromEntries(['value','score','margin','integerConfidence','fractionConfidence','inputHeight'].map(key=>[key,Number.isFinite(candidate[key])?Math.round(candidate[key]*1e6)/1e6:null])));
}
