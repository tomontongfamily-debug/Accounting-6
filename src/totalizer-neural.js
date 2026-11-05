import { prepareReaderFiles } from './ocr-downloads.js';
let ready;
export function prepareNeuralTotalizer(preparedFiles){
  ready ||= (async()=>{
    // Finish and verify downloads before starting the runtime's CPU-init clock.
    // The same bytes are reused by preparation and recognition, even on 3G.
    const [ort,files]=await Promise.all([import('onnxruntime-web/wasm'),preparedFiles||prepareReaderFiles()]);
    ort.env.wasm.numThreads=1;
    ort.env.wasm.initTimeout=20000;
    ort.env.wasm.wasmPaths={
      mjs:new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',import.meta.url).href,
    };
    ort.env.wasm.wasmBinary=files.wasm;
    let session;
    try{session=await ort.InferenceSession.create(new Uint8Array(files.model),{executionProviders:['wasm']});}
    finally{ort.env.wasm.wasmBinary=undefined;}
    return {ort,session,characters:JSON.parse(new TextDecoder().decode(files.characters))};
  })().catch(error=>{ready=undefined;throw error;});
  return ready;
}

// Preserve character certainty instead of allowing seven certain digits to
// conceal one uncertain digit in a high average confidence.
export function decodeTotalizerTokens(data,dims,characters){
  const [,steps,classes]=dims;let text='',previous=-1;const confidences=[];
  for(let t=0;t<steps;t++){
    let best=-Infinity,index=-1;
    for(let c=0;c<classes;c++){const p=data[t*classes+c];if(p>best){best=p;index=c;}}
    if(index!==0&&index!==previous){text+=characters[index]||'';confidences.push(best);}
    previous=index;
  }
  const trimmed=text.trim().replace(/\s+/g,'');
  const match=trimmed.match(/^(?:ER|R)?([\d.,]+)(?:L(?:ITER|ITI|IT|I7|I)?)?$/i);
  if(!match)return {text,value:null,score:0,integerConfidence:0,fractionConfidence:0};
  const digits=match[1].replace(/[.,]/g,'');
  if(digits.length!==8)return {text,value:null,score:0,integerConfidence:0,fractionConfidence:0};
  const digitScores=[...text].map((c,i)=>({c,p:confidences[i]})).filter(({c})=>/^\d$/.test(c)).map(x=>x.p);
  return {text,value:Number(digits)/100,score:digitScores.reduce((a,b)=>a+b,0)/8,integerConfidence:Math.min(...digitScores.slice(0,6)),fractionConfidence:Math.min(...digitScores.slice(6)),digitConfidences:digitScores};
}

function tensorForCrop(pixels,width,height,region,inputHeight){
  const x0=Math.max(0,Math.round(region.x-4)),y0=Math.max(0,Math.round(region.y-4));
  const x1=Math.min(width,Math.round(region.x+region.width+4)),y1=Math.min(height,Math.round(region.y+region.height+4));
  const w=x1-x0,h=y1-y0,ratio=w/h,inputWidth=Math.floor(inputHeight*Math.max(320/inputHeight,ratio));
  const resizedWidth=Math.min(inputWidth,Math.ceil(inputHeight*ratio));
  const result=new Float32Array(3*inputHeight*inputWidth),plane=inputHeight*inputWidth;
  for(let y=0;y<inputHeight;y++)for(let x=0;x<resizedWidth;x++){
    const sx=Math.max(0,Math.min(w-1,(x+.5)*w/resizedWidth-.5)),sy=Math.max(0,Math.min(h-1,(y+.5)*h/inputHeight-.5));
    const left=Math.floor(sx),top=Math.floor(sy),right=Math.min(w-1,left+1),bottom=Math.min(h-1,top+1),fx=sx-left,fy=sy-top;
    for(let channel=0;channel<3;channel++){
      const c=2-channel;
      const at=(xx,yy)=>pixels[((y0+yy)*width+x0+xx)*4+c];
      const value=(at(left,top)*(1-fx)+at(right,top)*fx)*(1-fy)+(at(left,bottom)*(1-fx)+at(right,bottom)*fx)*fy;
      result[channel*plane+y*inputWidth+x]=value/127.5-1;
    }
  }
  return {data:result,dims:[1,3,inputHeight,inputWidth]};
}

export async function neuralTotalizerCandidates(pixels,width,height,regions){
  const {ort,session,characters}=await prepareNeuralTotalizer(),readings=[];
  async function read(region,label,inputHeight){
    const input=tensorForCrop(pixels,width,height,region,inputHeight);
    const tensor=new ort.Tensor('float32',input.data,input.dims);
    try{
      const output=await session.run({[session.inputNames[0]]:tensor});
      try{
        const result=output[session.outputNames[0]],decoded=decodeTotalizerTokens(result.data,result.dims,characters);
        readings.push({...decoded,label,inputHeight});
      }finally{Object.values(output).forEach(value=>value.dispose());}
    }finally{tensor.dispose();}
  }
  for(const [i,region]of regions.slice(0,3).entries())for(const h of[48,32,64])await read(region,'region-'+i,h);
  if(!readings.some(r=>r.value!==null&&r.score>.9)){
    for(const [i,region]of regions.slice(0,3).entries()){
      if(region.fallback)for(const h of[48,64])await read(region.fallback,'tight-'+i,h);
      for(const [top,bottom]of [[.15,.85],[.3,1]])for(const h of[48,64])await read({...region,y:region.y+region.height*top,height:region.height*(bottom-top)},'vertical-'+i+'-'+top,h);
    }
  }
  return readings;
}
