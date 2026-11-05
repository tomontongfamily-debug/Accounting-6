import { createWorker } from 'tesseract.js';
import { TOTALIZER_VERSION } from './ocr-evidence.js';
import { neuralTotalizerCandidatesAsync as neuralTotalizerCandidates, readTotalizerGridAsync } from './totalizer-reader-client.js';
import { OCR_ASSET_VERSION, ocrAsset } from './ocr-assets.js';
import { chooseTotalizerReading, chooseFastTotalizerReading } from './totalizer-consensus.js';
import { readingWithVisibleDecimal, supportedTotalizerReading, refineLeadingLcdDigit, refineNarrowLcdDigits, verifyLcdDigits, segmentDisplaySymbols, withoutDisplayFrame, totalizerCrop, totalizerMask, totalizerRegions } from './totalizer-image.js';

let workerPromise;
let detectionQueue=Promise.resolve();
export function prepareTotalizer(){
  // Keep the larger fallback available, but do not make every clear photo
  // compete with its model/runtime download on a slow connection.
  workerPromise ||= createWorker('ssd_int',1,{workerPath:ocrAsset('worker.min.js'),corePath:ocrAsset('core'),langPath:ocrAsset('lang'),cachePath:OCR_ASSET_VERSION,workerBlobURL:false})
    .then(async worker=>{await worker.setParameters({tessedit_char_whitelist:'0123456789.',user_defined_dpi:'150'});return worker;})
    .catch(error=>{workerPromise=undefined;throw error;});
  return workerPromise;
}
export function detectTotalizer(data){
  const request=detectionQueue.catch(()=>{}).then(()=>recognizePhoto(data));
  detectionQueue=request;return request;
}

export async function detectTotalizerResult(data){
  const started=performance.now();
  try{
    const reading=await detectTotalizer(data);
    return {reading,attempt:{status:reading===null?'no-reading':'detected',version:TOTALIZER_VERSION,completedAt:new Date().toISOString(),durationMs:Math.round(performance.now()-started)}};
  }catch{
    return {reading:null,attempt:{status:'error',version:TOTALIZER_VERSION,reason:'recognition-failed',completedAt:new Date().toISOString(),durationMs:Math.round(performance.now()-started)}};
  }
}

async function recognizePhoto(data){
  let image;
  if(typeof data==='string'){image=new Image();image.src=data;await image.decode();}
  else{
    // Camera recognition uses a snapshot of the original pixels, before JPEG
    // compression can erase a narrow segment or turn a reflection into one.
    image=document.createElement('canvas');image.width=data.width;image.height=data.height;
    image.getContext('2d').putImageData(data,0,0);
  }
  const scale=Math.min(1,1280/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data,gray=new Uint8Array(canvas.width*canvas.height);
  for(let i=0;i<gray.length;i++)gray[i]=Math.round(.2126*pixels[i*4]+.7152*pixels[i*4+1]+.0722*pixels[i*4+2]);
  const analysis=totalizerRegions(gray,canvas.width,canvas.height);
  // Neither fallback can read a missing number row. Do not download a neural
  // runtime/model only to return an empty list of candidates.
  if(!analysis.regions.length)return null;
  const ready=prepareTotalizer();
  let worker;
  try{
    worker=await ready;
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
            await worker.setParameters({tessedit_pageseg_mode:mode});
            const {data:result}=await worker.recognize(part,{}, {text:true,blocks:true});
            const symbols=result.blocks?.flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words.flatMap(w=>w.symbols))))||[];
            const leading=refineLeadingLcdDigit(symbols.map(s=>({...s,bbox:{x0:s.bbox.x0+region.x-crop.pad,x1:s.bbox.x1+region.x-crop.pad,y0:s.bbox.y0+region.y-crop.pad,y1:s.bbox.y1+region.y-crop.pad}})),gray,canvas.width,canvas.height);
            const translated=refineNarrowLcdDigits(leading,gray,canvas.width,canvas.height);
            const digits=translated.filter(s=>/^\d$/.test(s.text));
            glyphs.push(...digits.filter(s=>s.confidence>=90&&!s.lcdAmbiguous));
            const verifiedLeading=digits[0]?.lcdVerified===true;
            if(readingWithVisibleDecimal(translated,analysis.components,{integerDigits:7,decimalPlaces:2})!==null)longDisplay=true;
            let value=result.confidence>=(verifiedLeading?40:70)&&digits.every(s=>s.confidence>=90&&!s.lcdAmbiguous)?supportedTotalizerReading(translated,analysis.components,segments):null;
            // Keep a physically verified alignment of the same numeric value.
            // An early crop with poor boxes must not hide a later verified pass.
            if(value!==null&&(!evidence.has(value)||verifyLcdDigits(translated,gray,canvas.width,canvas.height,segments)))evidence.set(value,{symbols:translated,segments});
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
      try{return await neuralTotalizerCandidates(pixels,canvas.width,canvas.height,analysis.regions);}catch(error){throw Object.assign(new Error('The automatic reader could not load. Please reconnect and retry.'),{cause:error,code:'model-unavailable'});}
    };
    let neural;
    if(value!==null){
      neural=await readNeural();
      const fast=chooseFastTotalizerReading({tesseract:value,neural});
      if(fast!==null)return fast;
    }
    const grid=await readTotalizerGridAsync(analysis.mask,canvas.width,canvas.height,analysis.regions,analysis.components);
    if(value===null&&!(grid[0]?.score<.08&&grid[0]?.margin>.04))return null;
    neural ||= await readNeural();
    return chooseTotalizerReading({tesseract:value,grid,neural,glyphs});
  }catch(error){workerPromise=undefined;if(worker)await worker.terminate();throw error;}
}
