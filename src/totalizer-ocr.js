import {createPrimaryTotalizer,boundedReaderTimeout,PRIMARY_INITIALIZATION_TIMEOUT_MS} from './totalizer-primary-client.js';
import {analyzeTotalizerFrame,cancelTotalizerFrame} from './totalizer-frame-client.js';
import { TOTALIZER_VERSION } from './ocr-evidence.js';
import { neuralTotalizerCandidatesAsync as neuralTotalizerCandidates, readTotalizerGridAsync, cancelAdvancedTotalizer } from './totalizer-reader-client.js';
import { chooseTotalizerReading, chooseFastTotalizerReading } from './totalizer-consensus.js';
import { readingWithVisibleDecimal, supportedTotalizerReading, corroboratedShortTotalizerSymbols, refineLeadingLcdDigit, refineNarrowLcdDigits, verifyLcdDigits, segmentDisplaySymbols, withoutDisplayFrame, totalizerCrop, totalizerMask } from './totalizer-image.js';

export const TOTALIZER_CLEAR_TARGET_MS=20000;
export const TOTALIZER_TIMEOUT_MS=30000;
export const BACKGROUND_PRIMARY_TIMEOUT_MS=60000;
let workerPromise,primarySession,framePreparation;
const detectionQueue=[];
let activeDetection;
function resetPrimary(session,error){
  if(!session)return;
  if(primarySession===session){primarySession=undefined;workerPromise=undefined;}
  session.terminate(error);
}
function acquirePrimary({initializationTimeoutMs,background=false}={}){
  if(!primarySession||primarySession.closed){
    const session=createPrimaryTotalizer({timeoutMs:boundedReaderTimeout(initializationTimeoutMs,PRIMARY_INITIALIZATION_TIMEOUT_MS)});
    session.background=background;
    primarySession=session;
    workerPromise=session.ready.catch(error=>{resetPrimary(session,error);throw error;});
  }
  return {session:primarySession,ready:workerPromise};
}
export function prepareTotalizer({timeoutMs}={}){
  try{
    const ready=acquirePrimary({initializationTimeoutMs:boundedReaderTimeout(timeoutMs,BACKGROUND_PRIMARY_TIMEOUT_MS),background:true}).ready;
    // Load the small image-analysis worker before the first capture too. A
    // prepared reader must not pause on Wi-Fi to start its geometry check.
    framePreparation ||= analyzeTotalizerFrame(new Uint8ClampedArray(4),1,1).catch(error=>{framePreparation=undefined;throw error;});
    return Promise.all([ready,framePreparation]).then(([session])=>session);
  }
  catch(error){return Promise.reject(error);}
}
function runNextDetection(){
  if(activeDetection)return;
  const job=detectionQueue.shift();if(!job)return;
  activeDetection=job;job.active=true;
  Promise.resolve().then(async()=>{job.check();const value=await recognizePhoto(job.data,job);job.check();job.finish(null,value);}).catch(error=>job.finish(error));
}
export function detectTotalizer(data,options={}){
  const timeoutMs=Math.min(TOTALIZER_TIMEOUT_MS,boundedReaderTimeout(options.timeoutMs,TOTALIZER_TIMEOUT_MS));
  const job={data,options,active:false,canceled:false,primary:null,deadline:performance.now()+timeoutMs};
  let cancel;
  const cancellation=new Promise(resolve=>{cancel=resolve;});
  job.wait=promise=>Promise.race([promise,cancellation.then(()=>{throw job.error;})]);
  job.check=()=>{if(!job.canceled&&performance.now()>=job.deadline)job.expire();if(job.canceled)throw job.error;};
  const request=new Promise((resolve,reject)=>{
    let settled=false;
    const finish=job.finish=(error,value)=>{
      if(settled)return;settled=true;clearTimeout(timer);job.active=false;job.data=null;
      if(activeDetection===job)activeDetection=undefined;
      else{const index=detectionQueue.indexOf(job);if(index>=0)detectionQueue.splice(index,1);}
      if(error)reject(error);else resolve(value);
      queueMicrotask(runNextDetection);
    };
    job.expire=()=>{
      if(settled)return;
      job.canceled=true;job.error=Object.assign(new Error('The automatic reading took too long. The photo can still be reviewed.'),{reason:'recognition-timeout'});
      // A queued expiry must not stop the photo that is currently running.
      if(job.active){
        // Let an explicitly/background-prepared engine finish downloading.
        // Expired captures stop awaiting it and can never begin late inference.
        if(!(job.primary?.background&&job.primary.initializing))resetPrimary(job.primary,job.error);
        framePreparation=undefined;cancelTotalizerFrame();cancelAdvancedTotalizer();
      }
      cancel();
      finish(job.error);
    };
    const timer=setTimeout(job.expire,timeoutMs);
  });
  // This promise is settled by the deadline even if an old worker never
  // responds. The next photo can recover without awaiting that old task.
  detectionQueue.push(job);runNextDetection();return request;
}

export async function detectTotalizerResult(data,options){
  const started=performance.now();
  try{
    const reading=await detectTotalizer(data,options);
    return {reading,attempt:{status:reading===null?'no-reading':'detected',version:TOTALIZER_VERSION,completedAt:new Date().toISOString(),durationMs:Math.round(performance.now()-started)}};
  }catch(error){
    const reason=['recognition-timeout','initialization-timeout','worker-failed','unsupported-browser'].includes(error.reason)?error.reason:'recognition-failed';
    return {reading:null,attempt:{status:'error',version:TOTALIZER_VERSION,reason,completedAt:new Date().toISOString(),durationMs:Math.round(performance.now()-started)}};
  }
}

async function recognizePhoto(data,job){
  job.check();
  let image;
  if(typeof data==='string'){image=new Image();image.src=data;await job.wait(image.decode());job.check();}
  else{
    // Camera recognition uses a snapshot of the original pixels, before JPEG
    // compression can erase a narrow segment or turn a reflection into one.
    image=document.createElement('canvas');image.width=data.width;image.height=data.height;
    image.getContext('2d').putImageData(data,0,0);
  }
  const scale=Math.min(1,1280/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const {gray,analysis}=await job.wait(analyzeTotalizerFrame(pixels,canvas.width,canvas.height));
  job.check();
  // Neither fallback can read a missing number row. Do not download a neural
  // runtime/model only to return an empty list of candidates.
  if(!analysis.regions.length)return null;
  const primary=acquirePrimary(job.options);job.primary=primary.session;
  let worker;
  try{
    worker=await job.wait(primary.ready);job.check();
    const readings=new Set(),evidence=new Map(),glyphs=[];
    let sensitiveMask,longDisplay=false;
    for(const primary of analysis.regions){
      const layouts=[primary,...(primary.fallback?[primary.fallback]:[])];
      let primaryDigits=0;
      for(const region of layouts){
        const clean=withoutDisplayFrame(analysis.mask,canvas.width,region);
        const segments=segmentDisplaySymbols(clean,canvas.width,region);
        if(segments.length===9)longDisplay=true;
        const votes=new Map(),agreed=new Set();
        for(const {grow,pad,sensitive}of [{grow:1,pad:20},{grow:2,pad:20},{grow:1,pad:40},{grow:1,pad:20,sensitive:true}]){
          // Retain the original row boundaries. Re-detecting them on a more
          // sensitive mask can mistake reflections for extra leading digits.
          // Once both segmentation modes agree on validated digits and a
          // visible decimal, repeated stroke variants add only latency.
          if(agreed.size===1)break;
          if(sensitive&&[...votes.values()].some(count=>count>=2))break;
          if(sensitive)sensitiveMask ||= totalizerMask(gray,canvas.width,canvas.height,5);
          const crop=totalizerCrop(sensitive?withoutDisplayFrame(sensitiveMask,canvas.width,region):clean,canvas.width,canvas.height,region,pad,grow);
          const part=document.createElement('canvas');part.width=crop.width;part.height=crop.height;
          part.getContext('2d').putImageData(new ImageData(crop.rgba,crop.width,crop.height),0,0);
          const passes=[];
          for(const mode of ['7','13']){
            job.check();await worker.setParameters({tessedit_pageseg_mode:mode});job.check();
            const {data:result}=await worker.recognize(part,{}, {text:true,blocks:true});job.check();
            const symbols=result.blocks?.flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words.flatMap(w=>w.symbols))))||[];
            const leading=refineLeadingLcdDigit(symbols.map(s=>({...s,bbox:{x0:s.bbox.x0+region.x-crop.pad,x1:s.bbox.x1+region.x-crop.pad,y0:s.bbox.y0+region.y-crop.pad,y1:s.bbox.y1+region.y-crop.pad}})),gray,canvas.width,canvas.height);
            const translated=refineNarrowLcdDigits(leading,gray,canvas.width,canvas.height);
            const digits=translated.filter(s=>/^\d$/.test(s.text));
            const corroborated=corroboratedShortTotalizerSymbols(translated,analysis.components,segments,{gray,width:canvas.width,height:canvas.height});
            const verifiedSymbols=corroborated||translated;
            glyphs.push(...verifiedSymbols.filter(s=>/^\d$/.test(s.text)&&s.confidence>=90&&!s.lcdAmbiguous));
            const verifiedLeading=digits[0]?.lcdVerified===true;
            if(readingWithVisibleDecimal(translated,analysis.components,{integerDigits:7,decimalPlaces:2})!==null)longDisplay=true;
            let value=result.confidence>=(verifiedLeading?40:70)&&digits.every(s=>s.confidence>=90&&!s.lcdAmbiguous)?supportedTotalizerReading(translated,analysis.components,segments,{gray,width:canvas.width,height:canvas.height}):null;
            // Keep a physically verified alignment of the same numeric value.
            // An early crop with poor boxes must not hide a later verified pass.
            if(value!==null&&(!evidence.has(value)||verifyLcdDigits(verifiedSymbols,gray,canvas.width,canvas.height,segments)))evidence.set(value,{symbols:verifiedSymbols,segments});
            if(region!==primary&&digits.length<primaryDigits)value=null;
            if(region===primary&&value!==null&&result.confidence>=80)primaryDigits=Math.max(primaryDigits,digits.length);
            passes.push({value,confidence:result.confidence});
            if(value!==null&&(result.confidence>=90||verifiedLeading))votes.set(value,(votes.get(value)||0)+1);
          }
          if(passes[0].value!==null&&passes[0].value===passes[1].value&&Math.max(...passes.map(p=>p.confidence))>=80)agreed.add(passes[0].value);
        }
        for(const [value,count]of votes)if(count>=2)agreed.add(value);
        // Agreement across layouts or stroke widths is required. The visible
        // decimal is checked separately; a tighter crop cannot omit a digit.
        if(agreed.size===1){readings.add([...agreed][0]);break;}
        if(agreed.size>1){readings.add(null);break;}
      }
    }
    const value=readings.size===1?[...readings][0]:null,candidate=evidence.get(value);
    const verified=candidate&&verifyLcdDigits(candidate.symbols,gray,canvas.width,canvas.height,candidate.segments)?value:null;
    if(verified!==null)return verified;
    // The existing neural/grid fallback fits eight cells. It cannot establish
    // a nine-cell reading and must not silently drop its leading digit.
    if(longDisplay)return null;
    // A neural model reads the original color row at several resolutions;
    // physical cell fitting independently checks the shape and decimal layout.
    // Model-loading failure retains the previously verified reader's behavior.
    const readNeural=async()=>{
      try{job.check();const result=await neuralTotalizerCandidates(pixels,canvas.width,canvas.height,analysis.regions);job.check();return result;}catch(error){job.check();if(error.reason==='unsupported-browser')throw error;throw Object.assign(new Error('The automatic reader could not load. Please reconnect and retry.'),{cause:error,code:'model-unavailable'});}
    };
    let neural;
    if(value!==null){
      neural=await readNeural();
      const fast=chooseFastTotalizerReading({tesseract:value,neural});
      if(fast!==null)return fast;
    }
    const grid=await readTotalizerGridAsync(analysis.mask,canvas.width,canvas.height,analysis.regions,analysis.components);
    job.check();
    if(value===null&&!(grid[0]?.score<.08&&grid[0]?.margin>.04))return null;
    neural ||= await readNeural();
    return chooseTotalizerReading({tesseract:value,grid,neural,glyphs});
  }catch(error){if(!job.canceled&&error.reason!=='unsupported-browser')resetPrimary(primary.session,error);throw error;}
}
