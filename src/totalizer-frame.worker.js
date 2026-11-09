import {totalizerRegions} from './totalizer-image.js';
import {enhanceTotalizerAnalysis} from './totalizer-panel.js';

globalThis.onmessage=({data:{id,pixels,width,height,panel}})=>{
  try{
    const gray=new Uint8Array(width*height);
    for(let i=0;i<gray.length;i++)gray[i]=Math.round(.2126*pixels[i*4]+.7152*pixels[i*4+1]+.0722*pixels[i*4+2]);
    let analysis=totalizerRegions(gray,width,height);
    if(panel){
      analysis=enhanceTotalizerAnalysis(gray,width,height,analysis);
    }
    globalThis.postMessage({id,gray,analysis},[gray.buffer,analysis.mask.buffer]);
  }catch{globalThis.postMessage({id,error:true});}
};
