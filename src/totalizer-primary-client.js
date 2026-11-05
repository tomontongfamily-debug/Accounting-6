import {OCR_ASSET_VERSION,ocrAsset} from './ocr-assets.js';

export const PRIMARY_INITIALIZATION_TIMEOUT_MS=10000;
let nextWorkerId=0;
const failure=(message,reason='worker-failed')=>Object.assign(new Error(message),{reason});
export function boundedReaderTimeout(value,fallback){
  return Number.isFinite(value)&&value>0?Math.max(1,Math.min(60000,value)):fallback;
}
async function encodedImage(image){
  if(image instanceof Uint8Array)return image;
  if(image instanceof ArrayBuffer)return new Uint8Array(image);
  const blob=await new Promise((resolve,reject)=>image.toBlob(value=>value?resolve(value):reject(failure('The camera image could not be encoded.')),'image/png'));
  if(typeof blob.arrayBuffer==='function')return new Uint8Array(await blob.arrayBuffer());
  return new Uint8Array(await new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(failure('The camera image could not be read.'));reader.readAsArrayBuffer(blob);
  }));
}

// Own the native worker immediately. The high-level vendor client does not
// expose it until initialization resolves, and cannot terminate a stuck load.
// This is the same pinned Tesseract 7 worker protocol, engine and PNG input.
export function createPrimaryTotalizer({timeoutMs=PRIMARY_INITIALIZATION_TIMEOUT_MS}={}){
  if(typeof Worker==='undefined'||typeof WebAssembly==='undefined')throw failure('This browser does not support the automatic reader.','unsupported-browser');
  let worker;
  try{worker=new Worker(ocrAsset('worker.min.js'));}
  catch{throw failure('This browser could not start the automatic reader.','unsupported-browser');}
  const workerId=`fueltech-primary-${++nextWorkerId}`,pending=new Map();
  let nextJobId=0,closed=false,initializing=true,closedError,timer;
  function terminate(error=failure('The automatic reader stopped. Please retry.')){
    if(closed)return;
    closed=true;initializing=false;closedError=error;clearTimeout(timer);worker.terminate();
    for(const request of pending.values())request.reject(error);
    pending.clear();
  }
  function call(action,payload){
    if(closed)return Promise.reject(closedError);
    return new Promise((resolve,reject)=>{
      const jobId=`${workerId}-${++nextJobId}`;pending.set(jobId,{resolve,reject});
      try{worker.postMessage({workerId,jobId,action,payload});}
      catch{terminate(failure('The automatic reader could not receive the image.'));}
    });
  }
  worker.onerror=event=>{event.preventDefault?.();terminate(failure('The automatic reader stopped unexpectedly. Please retry.'));};
  worker.onmessageerror=()=>terminate(failure('The automatic reader returned an unreadable response.'));
  worker.onmessage=({data:message})=>{
    const {jobId,status,data}=message||{},request=pending.get(jobId);
    if(!request||status==='progress')return;
    if(status==='reject'){terminate(failure('The automatic reader could not process the image.'));return;}
    if(status!=='resolve')return;
    pending.delete(jobId);request.resolve({jobId,data});
  };
  const session={worker,get closed(){return closed;},get initializing(){return initializing;},terminate,
    setParameters:params=>call('setParameters',{params}),
    recognize:async(image,options={},output={text:true})=>call('recognize',{image:await encodedImage(image),options,output}),
  };
  timer=setTimeout(()=>terminate(failure('The automatic reader took too long to start. Please retry.','initialization-timeout')),boundedReaderTimeout(timeoutMs,PRIMARY_INITIALIZATION_TIMEOUT_MS));
  session.ready=(async()=>{
    try{
      await call('load',{options:{lstmOnly:true,corePath:ocrAsset('core')}});
      await call('loadLanguage',{langs:'ssd_int',options:{langPath:ocrAsset('lang'),cachePath:OCR_ASSET_VERSION,gzip:true,lstmOnly:true}});
      await call('initialize',{langs:'ssd_int',oem:1,config:{}});
      await session.setParameters({tessedit_char_whitelist:'0123456789.',user_defined_dpi:'150'});
      if(closed)throw closedError;
      initializing=false;clearTimeout(timer);return session;
    }catch(error){terminate(error);throw error;}
  })();
  return session;
}
