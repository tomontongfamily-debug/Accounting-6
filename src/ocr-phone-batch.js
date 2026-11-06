// Diagnostic-only configuration. Signed links stay in the URL fragment and in
// memory; they must never be copied into the exported evidence.
const PHOTO_ORIGIN='https://chqinknijqtixeenhtvu.supabase.co';
const PHOTO_PREFIX='/storage/v1/object/sign/fueltech-pilot-photos/';
export const CALIBRATION_BYTES=96*1024;
export const LARGE_CALIBRATION_BYTES=1024*1024;
export const CALIBRATION_BYTE_CHOICES=Object.freeze([CALIBRATION_BYTES,256*1024,LARGE_CALIBRATION_BYTES]);
export const ANDROID_INGRESS_BURST_BYTES=128*1024;
export const CALIBRATION_LIMIT_TOLERANCE=1.3;
const BURST_SOURCE='https://android.googlesource.com/platform/frameworks/libs/net/+/8ef52686483cdff0040d22753bb516e99a96a88d/common/native/tcutils/tcutils.cpp';
const invalid=()=>Error('Invalid automatic photo-batch configuration.');
function text(value,max){
 if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw invalid();
 return value.trim();
}
export function parsePhoneBatch(fragment){
 if(!fragment||fragment==='#')return null;
 if(fragment.length>60000||!fragment.startsWith('#batch='))throw invalid();
 let raw;
 try{raw=JSON.parse(decodeURIComponent(fragment.slice(7)));}catch{throw invalid();}
 if(!raw||typeof raw!=='object'||!Array.isArray(raw.sources)||raw.sources.length<1||raw.sources.length>4)throw invalid();
 const waitFor=raw.waitFor??'enhanced',startDelayMs=raw.startDelayMs??0;
 if(raw.trace!==undefined&&typeof raw.trace!=='boolean')throw invalid();
 if(!['enhanced','primary','none'].includes(waitFor)||!Number.isInteger(startDelayMs)||startDelayMs<0||startDelayMs>60000)throw invalid();
 const rate=raw.expectedIngressBytesPerSecond??null;
 if(rate!==null&&(!Number.isFinite(rate)||rate<=0||rate>1e9))throw invalid();
 const probeBytes=raw.probeBytes===undefined?CALIBRATION_BYTES:raw.probeBytes;
 if(!CALIBRATION_BYTE_CHOICES.includes(probeBytes))throw invalid();
 const sources=raw.sources.map(source=>{
  if(!source||typeof source!=='object')throw invalid();
  const name=redactDiagnosticText(text(source.name,96)),difficulty=source.difficulty??'unspecified';
  if(!['easy','medium','hard','extreme','unspecified'].includes(difficulty))throw invalid();
  const stress=source.stress??'none',expectedOutcome=source.expectedOutcome??(stress==='extreme-glare'?'no-reading':'detected');
  if(!['none','extreme-glare'].includes(stress)||!['detected','no-reading'].includes(expectedOutcome))throw invalid();
  if(stress==='extreme-glare'&&expectedOutcome!=='no-reading')throw invalid();
  let expected=source.expected??null;
  if(expected!==null){
   if(!/^\d+(?:\.\d{1,2})?$/.test(String(expected))||!Number.isFinite(Number(expected))||Number(expected)>1e12)throw invalid();
   expected=Number(expected);
  }
  let url;
  try{
   url=new URL(text(source.url,12000));
   const path=decodeURIComponent(url.pathname);
   if(url.origin!==PHOTO_ORIGIN||url.username||url.password||url.hash||!path.startsWith(PHOTO_PREFIX)||path.length===PHOTO_PREFIX.length||/[\\\u0000-\u001f]/.test(path)||path.split('/').some(part=>part==='.'||part==='..')||!url.searchParams.get('token')||[...url.searchParams.keys()].some(key=>key!=='token'))throw invalid();
  }catch{throw invalid();}
  return {name,difficulty:stress==='extreme-glare'?'extreme (simulated)':difficulty,expected,stress,expectedOutcome,url:url.href};
 });
 return {sources,waitFor,startDelayMs,trace:raw.trace===true,networkLabel:raw.networkLabel===undefined?'not-recorded':redactDiagnosticText(text(raw.networkLabel,80)),
  deviceNote:raw.deviceNote===undefined?'':redactDiagnosticText(text(raw.deviceNote,180)),expectedIngressBytesPerSecond:rate,probeBytes};
}
export function safePhoneBatch(config){
 if(!config)return null;
 return {...config,sources:config.sources.map(({name,difficulty,expected,stress,expectedOutcome})=>({name,difficulty,expected,stress,expectedOutcome}))};
}
export function redactDiagnosticText(value){
 return String(value).replace(/https?:\/\/[^\s"'<>]+/gi,'[URL omitted]').replace(/token\s*[=:]\s*[^\s&,;]+/gi,'token=[omitted]');
}
const finite=value=>Number.isFinite(value)&&value>=0?value:null;
export function calibrationRequest(expectedByteCount=CALIBRATION_BYTES){
 if(!CALIBRATION_BYTE_CHOICES.includes(expectedByteCount))throw invalid();
 const range=expectedByteCount!==CALIBRATION_BYTES&&expectedByteCount!==LARGE_CALIBRATION_BYTES;
 return {path:expectedByteCount===CALIBRATION_BYTES?'/ocr-test/calibration.bin':'/ocr-test/calibration-large.bin',
  expectedByteCount,totalByteCount:expectedByteCount===CALIBRATION_BYTES?CALIBRATION_BYTES:LARGE_CALIBRATION_BYTES,
  headers:range?{Range:`bytes=0-${expectedByteCount-1}`}:{}};
}
export function validateCalibrationResponse({status,contentRange,contentLength,bytes,expectedByteCount=CALIBRATION_BYTES}){
 const request=calibrationRequest(expectedByteCount),range=request.headers.Range!==undefined;
 if(status!==(range?206:200))throw Error('Calibration response status did not match the requested byte range.');
 if(bytes!==expectedByteCount)throw Error('Calibration file size did not match the requested byte count.');
 if(contentLength!==null&&contentLength!==undefined&&(!/^\d+$/.test(contentLength)||Number(contentLength)!==expectedByteCount))throw Error('Calibration Content-Length did not match the requested byte count.');
 if(range?contentRange!==`bytes 0-${expectedByteCount-1}/${request.totalByteCount}`:contentRange!==null&&contentRange!==undefined)throw Error('Calibration Content-Range did not match the requested byte range.');
 return {status,contentRange:contentRange??null,contentLength:contentLength===null||contentLength===undefined?null:Number(contentLength),
  requestedRange:request.headers.Range??null,totalByteCount:request.totalByteCount};
}
export function calibrationMetrics({bytes,wallMs,resource,expectedByteCount=CALIBRATION_BYTES,expectedIngressBytesPerSecond=null}){
 const timing=resource?Object.fromEntries(['startTime','fetchStart','requestStart','responseStart','responseEnd','encodedBodySize','decodedBodySize','transferSize','workerStart'].map(key=>[key,finite(resource[key])])):null;
 const bodyMs=timing&&timing.responseEnd!==null&&timing.responseStart!==null?timing.responseEnd-timing.responseStart:null;
 const measuredMbps=bytes>0&&wallMs>0?bytes*8/wallMs/1000:null;
 const bodyMbps=timing?.encodedBodySize>0&&bodyMs>0?timing.encodedBodySize*8/bodyMs/1000:null;
 // Android's ingress tc policer permits a fixed initial burst. Keep the raw
 // measurements and label this lower bound explicitly; it is not carrier proof.
 const burstAdjustedBodyMbps=timing?.encodedBodySize>0&&bodyMs>0?Math.max(timing.encodedBodySize-ANDROID_INGRESS_BURST_BYTES,0)*8/bodyMs/1000:null;
 const theoreticalMinimumBodyMs=timing?.encodedBodySize>0&&Number.isFinite(expectedIngressBytesPerSecond)&&expectedIngressBytesPerSecond>0?Math.max(timing.encodedBodySize-ANDROID_INGRESS_BURST_BYTES,0)/expectedIngressBytesPerSecond*1000:null;
 let limitAssessment='not-requested',observedToRequestedRatio=null;
 if(expectedIngressBytesPerSecond!==null){
  if(!CALIBRATION_BYTE_CHOICES.includes(expectedByteCount)||bytes!==expectedByteCount||timing?.encodedBodySize!==expectedByteCount||bytes<=ANDROID_INGRESS_BURST_BYTES||!burstAdjustedBodyMbps||!timing?.transferSize||expectedIngressBytesPerSecond<=0||!Number.isFinite(expectedIngressBytesPerSecond))limitAssessment='not-verifiable';
  else{
   observedToRequestedRatio=burstAdjustedBodyMbps*1e6/8/expectedIngressBytesPerSecond;
   limitAssessment=observedToRequestedRatio>CALIBRATION_LIMIT_TOLERANCE?'requested-limit-not-observed':observedToRequestedRatio<.2?'slower-than-requested':'consistent-with-requested-limit';
  }
 }
 return {bytes,expectedByteCount,wallMs,bodyMs,measuredMbps,bodyMbps,burstAdjustedBodyMbps,theoreticalMinimumBodyMs,expectedIngressBytesPerSecond,observedToRequestedRatio,limitAssessment,resourceTiming:timing,
  burstModel:{kind:'Android ingress tc policer',assumedBurstBytes:ANDROID_INGRESS_BURST_BYTES,source:BURST_SOURCE,ratioBasis:'burstAdjustedBodyMbps',rateMeaning:'lower bound on the ingress rate needed for this delivery',upperRateTolerance:CALIBRATION_LIMIT_TOLERANCE},
  interpretation:'The adjusted body rate is a lower bound assuming the Android 128 KiB ingress burst, with 30% upper-rate tolerance. Probes at or below that burst cannot verify a limit; slower upstream delivery can be consistent without proving enforcement, carrier or network generation.'};
}
