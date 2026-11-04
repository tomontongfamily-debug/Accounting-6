import {OCR_ASSET_VERSION,ocrAsset} from './ocr-assets.js';

// These are public reader files only. Never put station photos or API replies
// in this cache. Integrity pins also reject an HTML rewrite or damaged copy.
export const OCR_FILE_CACHE=`fueltech-reader-${OCR_ASSET_VERSION}`;
export const OCR_DOWNLOADS={
 model:{path:'neural/english-mobile.onnx',bytes:7872351,sha256:'c3461add59bb4323ecba96a492ab75e06dda42467c9e3d0c18db5d1d21924be8'},
 wasm:{path:'ort/ort-wasm-simd-threaded.wasm',bytes:14848852,sha256:'4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d'},
 characters:{path:'neural/characters.json',bytes:3918,sha256:'0d4f1773cc13905b9b465b8cafbb4de9d17ad1a55807b201dbce91551e578f4d'},
};
const files=Object.entries(OCR_DOWNLOADS),totalBytes=files.reduce((sum,[,file])=>sum+file.bytes,0);
const listeners=new Set(),memory=new Map();let preparation;
let snapshot={status:'idle',percent:0,savedForReuse:false};
export const readerPreparation=()=>snapshot;
export function subscribeReaderPreparation(listener){listeners.add(listener);return()=>listeners.delete(listener);}
function publish(next){snapshot={...snapshot,...next};for(const listener of listeners)listener(snapshot);}
async function fileCache(){try{return await globalThis.caches?.open(OCR_FILE_CACHE);}catch{return null;}}
async function checked(bytes,file){
 if(bytes.byteLength!==file.bytes)throw Error('Reader file size did not match.');
 const hash=await crypto.subtle.digest('SHA-256',bytes);
 if([...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('')!==file.sha256)throw Error('Reader file check failed.');
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
 const response=await fetch(url,{cache:'force-cache',signal});
 if(!response.ok)throw Error('Reader download could not finish.');
 let bytes;
 if(response.body){
  const reader=response.body.getReader(),parts=[];let size=0;
  for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;
   if(size>file.bytes){await reader.cancel();throw Error('Reader file size did not match.');}
   parts.push(value);onProgress(size);
  }
  const joined=new Uint8Array(size);let offset=0;for(const part of parts){joined.set(part,offset);offset+=part.length;}bytes=joined.buffer;
 }else bytes=await response.arrayBuffer();
 await checked(bytes,file);onProgress(file.bytes);
 let stored=false;
 try{if(cache){await cache.put(url,new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(file.bytes)}}));stored=true;}}catch{ /* Quota/private-mode failure must not stop recognition. */ }
 if(!stored)memory.set(url,bytes);
 return{bytes,stored};
}

export function prepareReaderFiles(){
 if(preparation)return preparation;
 publish({status:'preparing',percent:0});
 preparation=(async()=>{
  const cache=await fileCache(),downloaded={},controller=new AbortController();let previous=-1;
  const settled=await Promise.allSettled(files.map(async([key,file])=>{
   try{
    const result=await readFile(file,cache,bytes=>{
     downloaded[key]=bytes;
     const percent=Math.min(99,Math.floor(Object.values(downloaded).reduce((sum,n)=>sum+n,0)/totalBytes*100));
     if(percent!==previous){previous=percent;publish({percent});}
    },controller.signal);return[key,result];
   }catch(error){controller.abort();throw error;}
  }));
  const failed=settled.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  const results=settled.map(result=>result.value);
  publish({status:'ready',percent:100,savedForReuse:results.every(([,result])=>result.stored)});
  return Object.fromEntries(results.map(([key,result])=>[key,result.bytes]));
 })().catch(error=>{publish({status:'error'});throw error;}).finally(()=>{preparation=undefined;});
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
