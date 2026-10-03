import { createWorker } from 'tesseract.js';
import { readingWithVisibleDecimal, totalizerCrop, totalizerRegions } from './totalizer-image.js';

let workerPromise;
let detectionQueue=Promise.resolve();
export function detectTotalizer(data){
  const request=detectionQueue.catch(()=>{}).then(()=>recognizePhoto(data));
  detectionQueue=request;return request;
}

async function recognizePhoto(data){
  const image=new Image();image.src=data;await image.decode();
  const scale=Math.min(1,1280/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data,gray=new Uint8Array(canvas.width*canvas.height);
  for(let i=0;i<gray.length;i++)gray[i]=Math.round(.2126*pixels[i*4]+.7152*pixels[i*4+1]+.0722*pixels[i*4+2]);
  const analysis=totalizerRegions(gray,canvas.width,canvas.height);
  workerPromise ||= createWorker('ssd_int',1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr/core',langPath:'/ocr/lang',workerBlobURL:false});
  let worker;
  try{
    worker=await workerPromise;
    const readings=new Set();
    for(const primary of analysis.regions){
      const layouts=[primary,...(primary.fallback?[primary.fallback]:[])];
      let primaryDigits=0;
      for(const region of layouts){
        const votes=new Map(),agreed=new Set();
        for(const {grow,pad}of [{grow:1,pad:20},{grow:2,pad:20},{grow:1,pad:40}]){
          const crop=totalizerCrop(analysis.mask,canvas.width,canvas.height,region,pad,grow);
          const part=document.createElement('canvas');part.width=crop.width;part.height=crop.height;
          part.getContext('2d').putImageData(new ImageData(crop.rgba,crop.width,crop.height),0,0);
          const passes=[];
          for(const mode of ['7','13']){
            await worker.setParameters({tessedit_char_whitelist:'0123456789.',tessedit_pageseg_mode:mode,user_defined_dpi:'150'});
            const {data:result}=await worker.recognize(part,{}, {text:true,blocks:true});
            const symbols=result.blocks?.flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words.flatMap(w=>w.symbols))))||[];
            const translated=symbols.map(s=>({...s,bbox:{x0:s.bbox.x0+region.x-crop.pad,x1:s.bbox.x1+region.x-crop.pad,y0:s.bbox.y0+region.y-crop.pad,y1:s.bbox.y1+region.y-crop.pad}}));
            const digits=translated.filter(s=>/^\d$/.test(s.text));
            let value=result.confidence>=70&&digits.every(s=>s.confidence>=90)?readingWithVisibleDecimal(translated,analysis.components):null;
            if(region!==primary&&digits.length<primaryDigits)value=null;
            if(region===primary&&value!==null&&result.confidence>=80)primaryDigits=Math.max(primaryDigits,digits.length);
            passes.push({value,confidence:result.confidence});
            if(value!==null&&result.confidence>=90)votes.set(value,(votes.get(value)||0)+1);
          }
          if(passes[0].value!==null&&passes[0].value===passes[1].value&&Math.max(...passes.map(p=>p.confidence))>=80)agreed.add(passes[0].value);
        }
        for(const [value,count]of votes)if(count>=2)agreed.add(value);
        // Agreement across layouts or stroke widths is required. The visible
        // decimal is checked separately; a tighter crop cannot omit a digit.
        if(agreed.size===1){readings.add([...agreed][0]);break;}
        if(agreed.size>1)return null;
      }
    }
    return readings.size===1?[...readings][0]:null;
  }catch(error){workerPromise=undefined;if(worker)await worker.terminate();throw error;}
}
