import {createPrimaryTotalizer,boundedReaderTimeout,PRIMARY_INITIALIZATION_TIMEOUT_MS} from './totalizer-primary-client.js';
import {preparePrimaryReaderFiles} from './ocr-downloads.js';
import {analyzeTotalizerFrame,cancelTotalizerFrame} from './totalizer-frame-client.js';
import { TOTALIZER_VERSION } from './ocr-evidence.js';
import { neuralTotalizerCandidatesAsync as neuralTotalizerCandidates, readTotalizerGridAsync, cancelAdvancedTotalizer } from './totalizer-reader-client.js';
import { chooseTotalizerReading, chooseFastTotalizerReading, chooseRescueTotalizerReading, gridMatchesPhysicalRow, gridExplainsOcrHints } from './totalizer-consensus.js';
import { readingWithVisibleDecimal, supportedTotalizerReading, provisionalShortTotalizerReading, physicalTotalizerCandidate, corroboratedShortTotalizerSymbols, refineLeadingLcdDigit, refineNarrowLcdDigits, verifyLcdDigits, segmentDisplaySymbols, withoutDisplayFrame, totalizerCrop, totalizerMask } from './totalizer-image.js';
import {createTotalizerTracer,traceSymbols,traceCandidates} from './totalizer-trace.js';
import {canDismissNineCellHint} from './totalizer-format-evidence.js';
import {confirmedTotalizerFormat} from './totalizer-formats.js';
import {isPrintedTotalizerArrow} from './totalizer-panel.js';

export const TOTALIZER_CLEAR_TARGET_MS=20000;
export const TOTALIZER_TIMEOUT_MS=30000;
export const BACKGROUND_PRIMARY_DOWNLOAD_TIMEOUT_MS=300000;
let workerPromise,primarySession,framePreparation;
const invalidationListeners=new Set();
export function subscribeTotalizerInvalidation(listener){invalidationListeners.add(listener);return()=>invalidationListeners.delete(listener);}
function invalidatePreparedReader(error){
  const event={primary:true,advanced:true,reason:error?.reason||'worker-failed'};
  for(const listener of invalidationListeners){try{listener(event);}catch{ /* A status subscriber cannot interrupt worker cleanup or deadlines. */ }}
}
const detectionQueue=[];
let activeDetection;
export function evaluateNineCellHints(layouts,{trace=false}={}){
  // A real ninth physical cell always blocks the eight-cell fallback. OCR-only
  // hints can be dismissed solely by proof from this exact layout and its own
  // qualified passes; evidence from another crop or number row cannot help.
  const evaluated=layouts.map(({physical,hints,agreeingPasses})=>{
    const decisions=trace?[]:undefined;
    const dismissed=hints.map((hint,hintIndex)=>{
      if(physical.symbols.length===9){if(trace)decisions.push({hintIndex,code:2,reason:'physical-nine-cells'});return false;}
      const proof={physical,hint,agreeingPasses};
      return trace?canDismissNineCellHint(proof,{onDecision:event=>decisions.push({hintIndex,...event})}):canDismissNineCellHint(proof);
    });
    return {regionIndex:physical.regionId,layoutIndex:physical.layoutId,physicalCount:physical.symbols.length,
      hintCount:hints.length,qualifiedEightPasses:agreeingPasses.length,dismissed,...(trace?{decisions}:{})};
  });
  return {blocked:evaluated.some(layout=>layout.physicalCount===9||layout.dismissed.some(dismissed=>!dismissed)),layouts:evaluated};
}
function resetPrimary(session,error,notify=true){
  if(!session)return;
  const current=primarySession===session;
  if(current){primarySession=undefined;workerPromise=undefined;}
  session.terminate(error);
  if(current&&notify)invalidatePreparedReader(error);
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
    // A cold phone may need minutes to download the public engine on weak
    // Wi-Fi. Finish/cache those files before starting the short CPU-init clock.
    // Every capture still has its own independent 30-second result deadline.
    const files=primarySession&&!primarySession.closed?Promise.resolve():preparePrimaryReaderFiles({timeoutMs:BACKGROUND_PRIMARY_DOWNLOAD_TIMEOUT_MS});
    const ready=files.then(()=>acquirePrimary({initializationTimeoutMs:boundedReaderTimeout(timeoutMs,PRIMARY_INITIALIZATION_TIMEOUT_MS),background:true}).ready);
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
  const job={data,options:{...options,format:confirmedTotalizerFormat(options.format)},active:false,canceled:false,primary:null,deadline:performance.now()+timeoutMs,
    tracing:typeof options.onTrace==='function',trace:createTotalizerTracer(options.onTrace)};
  job.trace('queued',{timeoutMs,queueLength:detectionQueue.length});
  let cancel;
  const cancellation=new Promise(resolve=>{cancel=resolve;});
  job.wait=promise=>Promise.race([promise,cancellation.then(()=>{throw job.error;})]);
  job.check=()=>{if(!job.canceled&&performance.now()>=job.deadline)job.expire();if(job.canceled)throw job.error;};
  const request=new Promise((resolve,reject)=>{
    let settled=false;
    const finish=job.finish=(error,value)=>{
      if(settled)return;settled=true;clearTimeout(timer);job.active=false;job.data=null;
      job.trace('final',{outcome:error?'error':value===null?'no-reading':'detected',value:value??null,reason:error?.reason||job.decision||'completed'},true);
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
        if(!(job.primary?.background&&job.primary.initializing))resetPrimary(job.primary,job.error,false);
        framePreparation=undefined;cancelTotalizerFrame();cancelAdvancedTotalizer();
        invalidatePreparedReader(job.error);
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
  const started=performance.now(),format=confirmedTotalizerFormat(options?.format);
  const formatEvidence=format?{formatProfile:format.id}:{};
  try{
    const reading=await detectTotalizer(data,options);
    return {reading,attempt:{status:reading===null?'no-reading':'detected',version:TOTALIZER_VERSION,...formatEvidence,completedAt:new Date().toISOString(),durationMs:Math.round(performance.now()-started)}};
  }catch(error){
    const reason=['recognition-timeout','initialization-timeout','worker-failed','unsupported-browser'].includes(error.reason)?error.reason:'recognition-failed';
    return {reading:null,attempt:{status:'error',version:TOTALIZER_VERSION,reason,...formatEvidence,completedAt:new Date().toISOString(),durationMs:Math.round(performance.now()-started)}};
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
  const first=await recognizeFrame(image,job,1280);
  if(first!==null)return first;
  // Preserve the proven fast path. A second resolution only rescues abstentions
  // and must agree with the independent neural reader within the same deadline.
  if(Math.max(image.width,image.height)>1280&&job.deadline-performance.now()>=8000){
    job.trace('resolution-rescue',{maximumDimension:1800});
    const second=await recognizeFrame(image,job,1800,true);
    if(second!==null)return second;
  }
  if(job.deadline-performance.now()<8000)return null;
  job.trace('panel-rescue',{maximumDimension:1280});
  return recognizeFrame(image,job,1280,true,true);
}

async function recognizeFrame(image,job,maximumDimension,rescue=false,panel=false){
  job.check();
  const scale=Math.min(1,maximumDimension/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  let frame;
  try{frame=await job.wait(analyzeTotalizerFrame(pixels,canvas.width,canvas.height,{panel}));}
  catch(error){if(!job.canceled){framePreparation=undefined;invalidatePreparedReader(error);}throw error;}
  const {gray,analysis}=frame;
  job.check();
  if(panel&&analysis.extraCellHint){job.decision='sensitive-extra-cell';return null;}
  if(job.tracing)job.trace('frame',{width:canvas.width,height:canvas.height,scale,componentCount:analysis.components.length,
    regions:analysis.regions.map(({x,y,width,height,bandHeight,fallback})=>({x,y,width,height,bandHeight,hasFallback:!!fallback}))});
  // Neither fallback can read a missing number row. Do not download a neural
  // runtime/model only to return an empty list of candidates.
  if(!analysis.regions.length){job.decision='no-number-row';return null;}
  // Reuse automatic background preparation instead of starting a competing
  // foreground download with a shorter timeout. A photo can expire without
  // discarding a weak connection's progress toward the next ready capture.
  if(!primarySession||primarySession.closed){await job.wait(preparePrimaryReaderFiles({timeoutMs:BACKGROUND_PRIMARY_DOWNLOAD_TIMEOUT_MS}));job.check();}
  const primary=acquirePrimary(job.options);job.primary=primary.session;
  let worker;
  try{
    worker=await job.wait(primary.ready);job.check();
    const readings=new Set(),evidence=new Map(),glyphs=[],layoutEvidence=[],shortVotes=new Map(),shortFormats=new Map();
    let sensitiveMask;
    for(const [regionIndex,primary]of analysis.regions.entries()){
      const layouts=[primary,...(primary.fallback?[primary.fallback]:[])];
      let primaryDigits=0;
      for(const [layoutIndex,region]of layouts.entries()){
        const clean=withoutDisplayFrame(analysis.mask,canvas.width,region);
        const segments=segmentDisplaySymbols(clean,canvas.width,region,{shear:panel,learned:panel});
        const profileRowValid=!job.options.format||!segments.some(s=>isPrintedTotalizerArrow(gray,canvas.width,canvas.height,s.bbox));
        if(job.tracing)job.trace('layout',{regionIndex,layoutIndex,box:{x:region.x,y:region.y,width:region.width,height:region.height},segments:traceSymbols(segments)});
        const format={physical:{regionId:regionIndex,layoutId:layoutIndex,profileRowValid,segmentation:panel?'enhanced':undefined,maskThreshold:analysis.maskThreshold,region,symbols:segments,components:analysis.components,image:{gray,width:canvas.width,height:canvas.height}},hints:[],agreeingPasses:[]};
        layoutEvidence.push(format);
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
            // Wait until all existing crops finish before evaluating an OCR-only
            // ninth digit. A later qualified pass can prove two glyph boxes
            // split one of the same eight physical cells, without adding a vote.
            if(readingWithVisibleDecimal(translated,analysis.components,{integerDigits:7,decimalPlaces:2})!==null)format.hints.push({regionId:regionIndex,layoutId:layoutIndex,symbols:translated});
            const formatAccepted=!job.options.format||digits.length===job.options.format.integerDigits+job.options.format.decimalPlaces;
            const confidenceAccepted=formatAccepted&&profileRowValid&&result.confidence>=(verifiedLeading?40:70)&&digits.every(s=>s.confidence>=90&&!s.lcdAmbiguous);
            // A short display can have a weak binary stroke but clear color
            // pixels. Keep a candidate only with complete physical cells, a
            // visible decimal, and no independently conflicting cell. It still
            // needs repeated primary passes and strict neural corroboration.
            if(confidenceAccepted){
              const provisional=provisionalShortTotalizerReading(translated,analysis.components,segments,{smallPoint:panel,format:job.options.format});
              if(provisional!==null){
                shortVotes.set(provisional,(shortVotes.get(provisional)||0)+1);
                shortFormats.set(provisional,shortFormats.has(provisional)&&shortFormats.get(provisional)!==digits.length?0:digits.length);
                if(job.options.format){
                  job.profileCandidates ||= new Map();
                  if(!job.profileCandidates.has(provisional))job.profileCandidates.set(provisional,new Set());
                  job.profileCandidates.get(provisional).add(`${canvas.width}x${canvas.height}`);
                }
              }
            }
            let value=confidenceAccepted?supportedTotalizerReading(translated,analysis.components,segments,{gray,width:canvas.width,height:canvas.height}):null;
            if(job.tracing)job.trace('primary-pass',{regionIndex,layoutIndex,grow,pad,sensitive:!!sensitive,mode,
              confidence:Math.round(result.confidence*10)/10,confidenceAccepted,minimumOverallConfidence:verifiedLeading?40:70,
              symbols:traceSymbols(translated),physicalBoxesUsed:!!corroborated,
              geometryValue:confidenceAccepted?value:supportedTotalizerReading(translated,analysis.components,segments,{gray,width:canvas.width,height:canvas.height}),
              sixIntegerDecimal:readingWithVisibleDecimal(translated,analysis.components,{integerDigits:6,decimalPlaces:2}),
              value,physicalVerified:value!==null&&verifyLcdDigits(verifiedSymbols,gray,canvas.width,canvas.height,segments)});
            // Keep a physically verified alignment of the same numeric value.
            // An early crop with poor boxes must not hide a later verified pass.
            if(value!==null&&(!evidence.has(value)||verifyLcdDigits(verifiedSymbols,gray,canvas.width,canvas.height,segments)))evidence.set(value,{symbols:verifiedSymbols,segments});
            if(region!==primary&&digits.length<primaryDigits)value=null;
            if(region===primary&&value!==null&&result.confidence>=80)primaryDigits=Math.max(primaryDigits,digits.length);
            if(value!==null&&digits.length===8)format.agreeingPasses.push({regionId:regionIndex,layoutId:layoutIndex,symbols:translated,confidence:result.confidence});
            passes.push({value,confidence:result.confidence});
            if(value!==null&&(result.confidence>=90||verifiedLeading))votes.set(value,(votes.get(value)||0)+1);
          }
          if(passes[0].value!==null&&passes[0].value===passes[1].value&&Math.max(...passes.map(p=>p.confidence))>=80)agreed.add(passes[0].value);
        }
        for(const [value,count]of votes)if(count>=2)agreed.add(value);
        if(job.tracing)job.trace('agreement',{regionIndex,layoutIndex,votes:[...votes].map(([value,count])=>({value,count})),agreed:[...agreed]});
        // Agreement across layouts or stroke widths is required. The visible
        // decimal is checked separately; a tighter crop cannot omit a digit.
        if(agreed.size===1){readings.add([...agreed][0]);break;}
        if(agreed.size>1){readings.add(null);break;}
      }
    }
    const value=readings.size===1?[...readings][0]:null,candidate=evidence.get(value);
    const verified=candidate&&verifyLcdDigits(candidate.symbols,gray,canvas.width,canvas.height,candidate.segments)?value:null;
    const formatEvidence=evaluateNineCellHints(layoutEvidence,{trace:job.tracing});
    let longDisplay=formatEvidence.blocked,rescueGrid;
    if(panel&&longDisplay&&job.deadline-performance.now()>=12000&&layoutEvidence.every(e=>e.physical.symbols.length<9)){
      rescueGrid=await job.wait(readTotalizerGridAsync(analysis.mask,canvas.width,canvas.height,analysis.regions,analysis.components));
      job.check();
      if(gridExplainsOcrHints(rescueGrid[0],layoutEvidence))longDisplay=false;
      if(job.tracing)job.trace('grid-format-proof',{accepted:!longDisplay,candidates:traceCandidates(rescueGrid)});
    }
    job.trace('format-evidence',formatEvidence);
    job.trace('primary-result',{readings:[...readings],value,hasPhysicalEvidence:!!candidate,verified,longDisplay});
    if(verified!==null&&!rescue){job.decision='primary-physical-verified';return verified;}
    // The existing neural/grid fallback fits eight cells. It cannot establish
    // a nine-cell reading and must not silently drop its leading digit.
    if(longDisplay){job.decision='nine-cell-fallback-blocked';return null;}
    // A neural model reads the original color row at several resolutions;
    // physical cell fitting independently checks the shape and decimal layout.
    // Model-loading failure retains the previously verified reader's behavior.
    const readNeural=async()=>{
      try{job.check();const result=await neuralTotalizerCandidates(pixels,canvas.width,canvas.height,analysis.regions,{shortDigits:job.options.format?job.options.format.integerDigits+job.options.format.decimalPlaces:panel&&readings.size===0&&shortCandidates.length===1?shortFormats.get(shortCandidates[0]):null});job.check();if(job.tracing)job.trace('neural',{candidates:traceCandidates(result)});return result;}catch(error){job.check();if(error.reason==='unsupported-browser')throw error;throw Object.assign(new Error('The automatic reader could not load. Please reconnect and retry.'),{cause:error,code:'model-unavailable'});}
    };
    let neural;
    const shortCandidates=[...new Set([...shortVotes.keys(),...(job.profileCandidates?.keys()||[])])]
      .filter(v=>(shortVotes.get(v)||0)>=(job.options.format?1:2)||(job.profileCandidates?.get(v)?.size||0)>=(job.options.format?1:2));
    if(((rescue||job.options.format)&&value!==null)||(readings.size===0&&shortCandidates.length===1&&!longDisplay)){
      neural=await readNeural();
      const singleFormatPass=job.options.format&&value===null&&(shortVotes.get(shortCandidates[0])||0)<2&&(job.profileCandidates?.get(shortCandidates[0])?.size||0)<2;
      const corroborated=chooseRescueTotalizerReading({primary:value??shortCandidates[0],neural,
        ...(singleFormatPass?{minimumViews:3,minimumScore:.99,minimumInteger:.98,minimumFraction:.98}:{}),digitCount:job.options.format?job.options.format.integerDigits+job.options.format.decimalPlaces:panel&&value===null?shortFormats.get(shortCandidates[0]):null});
      job.decision=corroborated===null?'rescue-consensus-rejected':'rescue-consensus-accepted';
      if(corroborated!==null||!rescue)return corroborated;
    }
    if(rescue){
      if(panel){
        const physicalValues=new Set(layoutEvidence.flatMap(({physical})=>{
          const number=physicalTotalizerCandidate(physical.symbols,analysis.components,{format:job.options.format});
          return number===null?[]:[number];
        }));
        if(physicalValues.size===1){
          neural ||= await readNeural();
          const chosen=chooseRescueTotalizerReading({primary:[...physicalValues][0],neural,digitCount:job.options.format?job.options.format.integerDigits+job.options.format.decimalPlaces:null});
          if(chosen!==null){job.decision='physical-neural-rescue';return chosen;}
        }
      }
      if(job.options.format){job.decision='confirmed-format-unverified';return null;}
      const rows=layoutEvidence.map(e=>e.physical.symbols).filter(cells=>cells.length>=4&&cells.length<=8);
      if(!rows.length){job.decision='rescue-no-complete-row';return null;}
      const grid=rescueGrid||await job.wait(readTotalizerGridAsync(analysis.mask,canvas.width,canvas.height,analysis.regions,analysis.components));
      job.check();if(job.tracing)job.trace('rescue-grid',{candidates:traceCandidates(grid)});
      const physical=grid[0];
      const complete=physical&&physical.score<.06&&physical.margin>.06&&
        physical.digitMargins?.length===8&&physical.digitMargins.every(m=>m>.06)&&
        rows.some(cells=>gridMatchesPhysicalRow(physical,cells));
      if(!complete){job.decision='rescue-grid-unverified';return null;}
      neural ||= await readNeural();
      const chosen=chooseRescueTotalizerReading({primary:physical.value,neural});
      job.decision=chosen===null?'rescue-grid-disagreement':'rescue-grid-accepted';return chosen;
    }
    if(job.options.format){job.decision='confirmed-format-unverified';return null;}
    if(value!==null){
      neural=await readNeural();
      const fast=chooseFastTotalizerReading({tesseract:value,neural});
      if(fast!==null){job.decision='fast-neural-consensus';return fast;}
    }
    const grid=await readTotalizerGridAsync(analysis.mask,canvas.width,canvas.height,analysis.regions,analysis.components);
    job.check();
    if(job.tracing)job.trace('grid',{candidates:traceCandidates(grid)});
    if(value===null&&!(grid[0]?.score<.08&&grid[0]?.margin>.04)){job.decision='no-primary-and-weak-grid';return null;}
    neural ||= await readNeural();
    const chosen=chooseTotalizerReading({tesseract:value,grid,neural,glyphs});
    job.decision=chosen===null?'final-consensus-rejected':'final-consensus-accepted';return chosen;
  }catch(error){if(!job.canceled&&error.reason!=='unsupported-browser')resetPrimary(primary.session,error);throw error;}
}
