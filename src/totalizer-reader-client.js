import { readTotalizerGrid } from './totalizer-grid.js';
import { prepareReaderFiles } from './ocr-downloads.js';
import {assertNeuralTotalizerSupport} from './ocr-capabilities.js';

let worker,nextId=0,preparation,generation=0,recognitionCancellation=new AbortController();
const pending=new Map();
function stopWorker(instance=worker){
  if(worker!==instance)return;
  worker?.terminate();worker=undefined;preparation=undefined;
  for(const request of pending.values()){
    clearTimeout(request.timer);request.reject(Error('The automatic reader stopped. Please retry.'));
  }
  pending.clear();
}
async function request(operation,args){
  if(typeof Worker==='undefined'){
    if(operation==='grid')return readTotalizerGrid(...args);
    const neural=await import('./totalizer-neural.js');
    if(operation==='prepare'){await neural.prepareNeuralTotalizer(args[0]);return true;}
    return neural.neuralTotalizerCandidates(...args);
  }
  if(!worker){
    const instance=new Worker(new URL('./totalizer-reader.worker.js',import.meta.url),{type:'module'});worker=instance;
    worker.onerror=()=>stopWorker(instance);worker.onmessageerror=()=>stopWorker(instance);
    worker.onmessage=({data:{id,result,error}})=>{
      if(worker!==instance)return;
      const entry=pending.get(id);if(!entry)return;
      pending.delete(id);clearTimeout(entry.timer);
      if(error){stopWorker(instance);entry.reject(Error('The automatic reader could not check the display.'));}
      else entry.resolve(result);
    };
  }
  const instance=worker;
  return new Promise((resolve,reject)=>{
    const id=++nextId,timer=setTimeout(()=>stopWorker(instance),30000);
    pending.set(id,{resolve,reject,timer});
    // Copy rather than transfer: cached model buffers and the original photo
    // must remain usable after a failed worker or a retry.
    try{instance.postMessage({id,operation,args});}catch{stopWorker(instance);}
  });
}
export function cancelAdvancedTotalizer(){
  generation++;
  recognitionCancellation.abort();recognitionCancellation=new AbortController();
  // Keep downloading public files in the background, but an expired photo
  // must not resume inference when that download eventually completes.
  if(worker)stopWorker();
}
export const readTotalizerGridAsync=(...args)=>request('grid',args);
export function prepareAdvancedTotalizer(){
  try{assertNeuralTotalizerSupport();}catch(error){return Promise.reject(error);}
  // Download/integrity checking finishes before the worker's CPU-init clock.
  // Pass those verified bytes so private browsers need no second download.
  preparation ||= prepareReaderFiles().then(files=>request('prepare',[files])).catch(error=>{preparation=undefined;throw error;});
  return preparation;
}
export async function neuralTotalizerCandidatesAsync(...args){
  const started=generation,signal=recognitionCancellation.signal;
  let cancel;
  try{
    await Promise.race([prepareAdvancedTotalizer(),new Promise((_,reject)=>{
      cancel=()=>reject(Error('The previous reading was cancelled.'));
      if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
    })]);
  }finally{signal.removeEventListener('abort',cancel);}
  if(started!==generation)throw Error('The previous reading was cancelled.');
  return request('neural',args);
}
