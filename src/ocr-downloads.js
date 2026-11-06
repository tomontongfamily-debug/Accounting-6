import {OCR_ASSET_VERSION,ocrAsset} from './ocr-assets.js';

// These are public reader files only. Never put station photos or API replies
// in this cache. Integrity pins also reject an HTML rewrite or damaged copy.
export const OCR_FILE_CACHE=`fueltech-reader-${OCR_ASSET_VERSION}`;
export const OCR_DOWNLOADS={
 model:{path:'neural/english-mobile.onnx',bytes:7872351,sha256:'c3461add59bb4323ecba96a492ab75e06dda42467c9e3d0c18db5d1d21924be8'},
 wasm:{path:'ort/ort-wasm-simd-threaded.wasm',bytes:14848852,sha256:'4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d'},
 characters:{path:'neural/characters.json',bytes:3918,sha256:'0d4f1773cc13905b9b465b8cafbb4de9d17ad1a55807b201dbce91551e578f4d'},
};
// The first-pass seven-segment reader must survive a page refresh without
// waiting on Wi-Fi again. Each phone stores only its supported LSTM core.
export const PRIMARY_OCR_DOWNLOADS={
 worker:{path:'worker.min.js',bytes:111307,sha256:'576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d'},
 language:{path:'lang/ssd_int.traineddata.gz',bytes:1302536,sha256:'a5bf958bbb16a7532ac1c46effcd25e1534af876e239c15579795ce0f48af136',decoded:{bytes:1442809,sha256:'557759383e030694420ee9f6a88e824abae4acf17f7b94415ca07e1152339339'}},
 plain:{path:'core/tesseract-core-lstm.wasm.js',bytes:3896484,sha256:'eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680'},
 simd:{path:'core/tesseract-core-simd-lstm.wasm.js',bytes:3899472,sha256:'c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38'},
 relaxed:{path:'core/tesseract-core-relaxedsimd-lstm.wasm.js',bytes:3905767,sha256:'861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3'},
};
let primaryPreparation;
export function primaryCoreVariant(){
 // Feature probes use the standard WebAssembly SIMD opcodes. Never choose a
 // faster core solely from the browser's name or network connection type.
 const validate=bytes=>globalThis.WebAssembly?.validate(new Uint8Array(bytes));
 try{
  if(validate([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,15,1,13,0,65,1,253,15,65,2,253,15,253,128,2,11]))return 'relaxed';
  if(validate([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]))return 'simd';
 }catch{ /* The portable core remains available on older phones. */ }
 return 'plain';
}
const files=Object.entries(OCR_DOWNLOADS),totalBytes=files.reduce((sum,[,file])=>sum+file.bytes,0);
const listeners=new Set(),memory=new Map();let preparation;
let snapshot={status:'idle',percent:0,savedForReuse:false};
export const readerPreparation=()=>snapshot;
export function subscribeReaderPreparation(listener){listeners.add(listener);return()=>listeners.delete(listener);}
function publish(next){snapshot={...snapshot,...next};for(const listener of listeners)listener(snapshot);}
async function fileCache(){try{return await globalThis.caches?.open(OCR_FILE_CACHE);}catch{return null;}}
function downloadError(){return Object.assign(Error('Reader preparation timed out. Please retry on a stronger connection.'),{code:'reader-download-timeout'});}
function untilAborted(promise,signal){
 if(signal.aborted)return Promise.reject(signal.reason||downloadError());
 let aborted;
 const stop=new Promise((_,reject)=>{aborted=()=>reject(signal.reason||downloadError());signal.addEventListener('abort',aborted,{once:true});});
 return Promise.race([promise,stop]).finally(()=>signal.removeEventListener('abort',aborted));
}
async function checked(bytes,file){
 // Static hosts may expose .gz as Content-Encoding:gzip, which browsers
 // transparently decode. Pin both exact representations of this public file.
 const expected=bytes.byteLength===file.decoded?.bytes?file.decoded:file;
 if(bytes.byteLength!==expected.bytes)throw Error('Reader file size did not match.');
 const hash=await crypto.subtle.digest('SHA-256',bytes);
 if([...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('')!==expected.sha256)throw Error('Reader file check failed.');
 return bytes;
}
async function readFile(file,cache,onProgress,signal){
 const url=ocrAsset(file.path);
 if(memory.has(url)){onProgress(file.bytes);return{bytes:memory.get(url),stored:false};}
 let cached;
 try{cached=await cache?.match(url);}catch{ /* Storage is optional. */ }
 if(cached){
  try{const bytes=await checked(await cached.arrayBuffer(),file);onProgress(file.bytes);return{bytes,stored:true};}
  catch{try{await cache.delete(url);}catch{ /* Refetch only this public file. */ }}
 }
 const response=await untilAborted(fetch(url,{cache:'force-cache',signal}),signal);
 if(!response.ok)throw Error('Reader download could not finish.');
 let bytes;
 if(response.body){
  const reader=response.body.getReader(),parts=[];let size=0;
  for(;;){const{done,value}=await untilAborted(reader.read(),signal);if(done)break;size+=value.length;
   if(size>Math.max(file.bytes,file.decoded?.bytes||0)){await reader.cancel();throw Error('Reader file size did not match.');}
   parts.push(value);onProgress(size);
  }
  const joined=new Uint8Array(size);let offset=0;for(const part of parts){joined.set(part,offset);offset+=part.length;}bytes=joined.buffer;
 }else bytes=await response.arrayBuffer();
 await checked(bytes,file);onProgress(file.bytes);
 let stored=false;
 try{if(cache){await cache.put(url,new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(bytes.byteLength)}}));stored=true;}}catch{ /* Quota/private-mode failure must not stop recognition. */ }
 if(!stored)memory.set(url,bytes);
 return{bytes,stored};
}

export function preparePrimaryReaderFiles({timeoutMs=60000}={}){
 if(primaryPreparation)return primaryPreparation;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(downloadError()),timeoutMs);
 primaryPreparation=untilAborted((async()=>{
  const cache=await untilAborted(fileCache(),controller.signal);
  const core=PRIMARY_OCR_DOWNLOADS[primaryCoreVariant()];
  const entries=[['worker',PRIMARY_OCR_DOWNLOADS.worker],['core',core],['language',PRIMARY_OCR_DOWNLOADS.language]];
  try{
   const files=await Promise.all(entries.map(async([key,file])=>[key,(await readFile(file,cache,()=>{},controller.signal)).bytes]));
   return Object.fromEntries(files);
  }catch(error){controller.abort(error);throw error;}
 })(),controller.signal).finally(()=>{clearTimeout(timer);primaryPreparation=undefined;});
 return primaryPreparation;
}

export function prepareReaderFiles({timeoutMs=90000}={}){
 if(preparation)return preparation;
 publish({status:'preparing',percent:0});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(downloadError()),timeoutMs);
 preparation=untilAborted((async()=>{
  const cache=await untilAborted(fileCache(),controller.signal),downloaded={};let previous=-1;
  const settled=await Promise.allSettled(files.map(async([key,file])=>{
   try{
    const result=await readFile(file,cache,bytes=>{
     if(controller.signal.aborted)return;downloaded[key]=bytes;
     const percent=Math.min(99,Math.floor(Object.values(downloaded).reduce((sum,n)=>sum+n,0)/totalBytes*100));
     if(percent!==previous){previous=percent;publish({percent});}
    },controller.signal);return[key,result];
   }catch(error){controller.abort(error);throw error;}
  }));
  const failed=settled.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  const results=settled.map(result=>result.value);
  if(controller.signal.aborted)throw controller.signal.reason||downloadError();
  publish({status:'ready',percent:100,savedForReuse:results.every(([,result])=>result.stored)});
  return Object.fromEntries(results.map(([key,result])=>[key,result.bytes]));
 })(),controller.signal).catch(error=>{publish({status:'error'});throw error;}).finally(()=>{clearTimeout(timer);preparation=undefined;});
 return preparation;
}

export async function hasPreparedReaderFiles(){
 if(snapshot.status==='ready')return true;
 const cache=await fileCache();if(!cache)return false;
 try{return(await Promise.all(files.map(([,file])=>cache.match(ocrAsset(file.path))))).every(Boolean);}catch{return false;}
}
export function canPrepareReaderAutomatically(connection=globalThis.navigator?.connection){
 return !!connection&&!connection.saveData&&connection.effectiveType==='4g'&&connection.downlink>=8;
}
